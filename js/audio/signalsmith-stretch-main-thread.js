/**
 * AudioWorklet 非対応環境（file:// 等）向け Signalsmith Stretch オフライン描画。
 * Worklet 版 addBuffers 経路と同等の WASM 処理をメインスレッドで実行する。
 */
(function () {
    'use strict';

    const wasmReadyPromise = { current: null };

    function wasmFactory() {
        if (typeof SignalsmithStretchWasmFactory !== 'function') {
            return null;
        }
        return SignalsmithStretchWasmFactory;
    }

    function wasmMemory(wasm) {
        return wasm.exports ? wasm.exports.memory.buffer : wasm.HEAP8.buffer;
    }

    async function getWasmModule() {
        const factory = wasmFactory();
        if (!factory) {
            throw new Error('SignalsmithStretchWasmFactory unavailable');
        }
        if (!wasmReadyPromise.current) {
            wasmReadyPromise.current = (async () => {
                const wasm = await factory();
                await wasm;
                wasm._main();
                return wasm;
            })();
        }
        return wasmReadyPromise.current;
    }

    function bindBufferPointers(wasm, channels, bufferLength) {
        const lengthBytes = bufferLength * 4;
        const bufferPointer = wasm._setBuffers(channels, bufferLength);
        const buffersIn = [];
        const buffersOut = [];
        for (let c = 0; c < channels; c++) {
            buffersIn.push(bufferPointer + lengthBytes * c);
            buffersOut.push(bufferPointer + lengthBytes * (c + channels));
        }
        return { buffersIn, buffersOut };
    }

    function copyAddBuffersInput(
        wasm,
        audioBuffers,
        audioBuffersStart,
        bufferLength,
        inputSamplesEnd,
        buffersIn,
        channels,
    ) {
        const memory = wasmMemory(wasm);
        const buffers = [];
        for (let c = 0; c < channels; c++) {
            buffers.push(new Float32Array(memory, buffersIn[c], bufferLength));
        }

        let blockSamples = 0;
        let audioBufferIndex = 0;
        let audioSamples = audioBuffersStart;
        let inputSamples = inputSamplesEnd - bufferLength;

        if (inputSamples < audioSamples) {
            blockSamples = audioSamples - inputSamples;
            buffers.forEach((b) => b.fill(0, 0, blockSamples));
            inputSamples = audioSamples;
        }

        while (
            audioBufferIndex < audioBuffers.length &&
            audioSamples < inputSamplesEnd
        ) {
            const audioBuffer = audioBuffers[audioBufferIndex];
            const startIndex = inputSamples - audioSamples;
            const count = Math.min(
                audioBuffer[0].length - startIndex,
                inputSamplesEnd - inputSamples,
            );
            if (count > 0) {
                buffers.forEach((buffer, c) => {
                    const channelBuffer = audioBuffer[c % audioBuffer.length];
                    buffer
                        .subarray(blockSamples)
                        .set(channelBuffer.subarray(startIndex, startIndex + count));
                });
                audioSamples += count;
                blockSamples += count;
            } else {
                audioSamples += audioBuffer[0].length;
            }
            audioBufferIndex += 1;
        }

        if (blockSamples < bufferLength) {
            buffers.forEach((buffer) => buffer.subarray(blockSamples).fill(0));
        }
    }

    /**
     * @param {Float32Array[]} channelArrays
     * @param {number} sampleRate
     * @param {number} stretchRate inputSec / outputSec
     * @param {number} semitones
     * @param {number} targetFrames タイムライン上の出力フレーム数
     * @returns {Promise<{channelArrays: Float32Array[], sampleRate: number, extractStart: number}|null>}
     */
    async function renderSignalsmithStretchMainThread(
        channelArrays,
        sampleRate,
        stretchRate,
        semitones,
        targetFrames,
    ) {
        if (!channelArrays || !channelArrays.length || !(sampleRate > 0)) {
            return null;
        }

        const channels = channelArrays.length;
        const wasm = await getWasmModule();
        wasm._presetDefault(channels, sampleRate);

        const inputLatencySamples = wasm._inputLatency();
        const outputLatencySamples = wasm._outputLatency();
        const bufferLength = inputLatencySamples + outputLatencySamples;
        const { buffersIn, buffersOut } = bindBufferPointers(
            wasm,
            channels,
            bufferLength,
        );

        const inputLatencySec = inputLatencySamples / sampleRate;
        const outputLatencySec = outputLatencySamples / sampleRate;
        const playOutputStartSec = outputLatencySec;

        const audioBuffers = channelArrays.map((arr) => new Float32Array(arr));
        const audioBuffersStart = 0;

        const blockSize = 128;
        const marginFrames = Math.ceil(sampleRate * 2);
        const totalOutputFrames =
            targetFrames + outputLatencySamples + marginFrames;
        const outChannels = [];
        for (let c = 0; c < channels; c++) {
            outChannels.push(new Float32Array(totalOutputFrames));
        }

        const tonalityNorm = 8000 / sampleRate;
        let outPos = 0;

        while (outPos + blockSize <= totalOutputFrames) {
            const outputTime = playOutputStartSec + outPos / sampleRate;
            const inputTime =
                (outputTime - playOutputStartSec) * stretchRate + inputLatencySec;
            const inputSamplesEnd = Math.round(inputTime * sampleRate);

            copyAddBuffersInput(
                wasm,
                [audioBuffers],
                audioBuffersStart,
                bufferLength,
                inputSamplesEnd,
                buffersIn,
                channels,
            );

            wasm._setTransposeSemitones(semitones, tonalityNorm);
            wasm._setFormantSemitones(0, false);
            wasm._setFormantBase(0);
            wasm._seek(bufferLength, stretchRate);
            wasm._process(0, blockSize);

            const memory = wasmMemory(wasm);
            for (let c = 0; c < channels; c++) {
                const block = new Float32Array(memory, buffersOut[c], blockSize);
                outChannels[c].set(block, outPos);
            }
            outPos += blockSize;
        }

        return {
            channelArrays: outChannels,
            sampleRate,
            extractStart: outputLatencySamples,
            targetFrames,
        };
    }

    function canUsePitchStretchWorklet() {
        return (
            typeof window !== 'undefined' &&
            window.isSecureContext &&
            typeof AudioWorkletNode !== 'undefined'
        );
    }

    window.renderSignalsmithStretchMainThread = renderSignalsmithStretchMainThread;
    window.canUsePitchStretchWorklet = canUsePitchStretchWorklet;
})();
