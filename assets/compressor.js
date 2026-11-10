/**
 * Lightweight Client-Side Compressor using Native CompressionStream API
 * Optimized for low-memory mobile devices with full legacy browser fallbacks.
 */

export async function compressData(dataString) {
  // Fallback if input is empty or CompressionStream is not supported by older cheap phones
  if (!dataString || typeof CompressionStream === 'undefined') {
    return dataString;
  }

  try {
    const stream = new Blob([dataString]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressedBlob = await new Response(stream).blob();
    
    // Use FileReader for efficient, low-memory base64 conversion without manual loop bottlenecks
    const base64String = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Extract base64 part after the data URL scheme header
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(compressedBlob);
    });

    return base64String;
  } catch (err) {
    console.warn('CompressionStream failed, falling back to raw string:', err);
    return dataString; // Safe fallback
  }
}

export async function decompressData(base64CompressedString) {
  // If string is empty, or looks like raw JSON fallback instead of compressed base64, return as-is
  if (!base64CompressedString || base64CompressedString.startsWith('{') || typeof DecompressionStream === 'undefined') {
    return base64CompressedString;
  }
  
  try {
    // Convert base64 string back to binary Uint8Array safely
    const binary = window.atob(base64CompressedString);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressedBlob = await new Response(stream).blob();
    return await decompressedBlob.text();
  } catch (err) {
    console.error('Decompression failed, returning original string as fallback:', err);
    return base64CompressedString;
  }
}