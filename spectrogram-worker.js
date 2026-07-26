self.onmessage = ({ data }) => {
  const { samples, columns, rows, fftSize, windows, sampleRate } = data;
  const values = new Float32Array(columns * rows);
  const real = new Float32Array(fftSize);
  const imaginary = new Float32Array(fftSize);
  const window = Float32Array.from({ length: fftSize }, (_, index) =>
    .5 - .5 * Math.cos(2 * Math.PI * index / (fftSize - 1)));
  const maxFrequency = Math.min(12000, sampleRate * .47);

  for (let column = 0; column < columns; column++) {
    values.fill(-Infinity, column * rows, (column + 1) * rows);
    for (let sampleWindow = 0; sampleWindow < windows; sampleWindow++) {
      const offset = (column * windows + sampleWindow) * fftSize;
      for (let index = 0; index < fftSize; index++) {
        real[index] = samples[offset + index] * window[index];
        imaginary[index] = 0;
      }
      fft(real, imaginary);
      for (let row = 0; row < rows; row++) {
        const frequency = (1 - row / (rows - 1)) * maxFrequency;
        const bin = Math.max(1, Math.min(fftSize / 2 - 2, Math.round(frequency / sampleRate * fftSize)));
        let power = 0;
        for (let spread = -1; spread <= 1; spread++) {
          const realValue = real[bin + spread];
          const imaginaryValue = imaginary[bin + spread];
          power = Math.max(power, realValue * realValue + imaginaryValue * imaginaryValue);
        }
        const valueIndex = column * rows + row;
        values[valueIndex] = Math.max(values[valueIndex], 10 * Math.log10(power + 1e-12));
      }
    }
  }

  // trim noise floor so calls stay legible
  const sorted = Float32Array.from(values).sort();
  const low = sorted[Math.floor(sorted.length * .44)];
  const high = sorted[Math.floor(sorted.length * .995)];
  const range = Math.max(1, high - low);
  for (let index = 0; index < values.length; index++) {
    const normalized = Math.max(0, Math.min(1, (values[index] - low) / range));
    values[index] = Math.pow(normalized, .72);
  }
  self.postMessage({ values, columns, rows }, [values.buffer]);
};

function fft(real, imaginary) {
  const length = real.length;
  for (let index = 1, reversed = 0; index < length; index++) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index >= reversed) continue;
    const realValue = real[index];
    const imaginaryValue = imaginary[index];
    real[index] = real[reversed];
    imaginary[index] = imaginary[reversed];
    real[reversed] = realValue;
    imaginary[reversed] = imaginaryValue;
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let phaseReal = 1;
      let phaseImaginary = 0;
      for (let offset = 0; offset < size / 2; offset++) {
        const even = start + offset;
        const odd = even + size / 2;
        const oddReal = real[odd] * phaseReal - imaginary[odd] * phaseImaginary;
        const oddImaginary = real[odd] * phaseImaginary + imaginary[odd] * phaseReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextPhaseReal = phaseReal * stepReal - phaseImaginary * stepImaginary;
        phaseImaginary = phaseReal * stepImaginary + phaseImaginary * stepReal;
        phaseReal = nextPhaseReal;
      }
    }
  }
}
