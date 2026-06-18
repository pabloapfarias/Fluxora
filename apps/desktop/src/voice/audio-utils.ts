export async function convertToWav(blob: Blob, sampleRate = 16000): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  // Usa o AudioContext para decodificar o áudio original (WebM, Ogg, etc)
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    // Para testes no jsdom ou navegadores não suportados
    return blob;
  }
  
  const audioCtx = new AudioContextClass({ sampleRate });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  const numChannels = 1; // Força mono para o whisper.cpp
  const bitsPerSample = 16; // 16-bit PCM
  
  // Mixdown para mono se tiver mais de um canal
  let channelData = audioBuffer.getChannelData(0);
  if (audioBuffer.numberOfChannels > 1) {
    const mixed = new Float32Array(audioBuffer.length);
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const cd = audioBuffer.getChannelData(c);
      for (let i = 0; i < audioBuffer.length; i++) {
        mixed[i] += cd[i] / audioBuffer.numberOfChannels;
      }
    }
    channelData = mixed;
  }

  const numSamples = channelData.length;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;
  
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // byte rate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // block align
  view.setUint16(34, bitsPerSample, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Escreve os samples PCM 16-bit
  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  return new Blob([buffer], { type: "audio/wav" });
}
