// ================================================================
// JobHub — File Parsers (docx / pdf / txt)
// 零服务器依赖，纯浏览器端解析
// ================================================================

// ---------- TXT ----------
async function parseTxt(arrayBuffer) {
  let text = new TextDecoder('utf-8').decode(arrayBuffer);
  // Try GBK if UTF-8 didn't produce readable CJK
  if (!/[一-鿿]/.test(text)) {
    try { text = new TextDecoder('gbk').decode(arrayBuffer); } catch {}
  }
  return text;
}

// ---------- DOCX (via JSZip) ----------
async function parseDocx(arrayBuffer) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip 未加载，请刷新扩展');
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('无法解析 docx：未找到 document.xml');

  const xml = await docXmlFile.async('string');
  const text = extractDocxText(xml);

  if (!text || text.length < 5) {
    throw new Error('docx 文件可能为空或格式特殊，请尝试复制粘贴简历文本');
  }
  return text;
}

function extractDocxText(xml) {
  const paragraphs = [];

  // Match <w:p ...> or <w:p> ... </w:p>
  const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pXml = pMatch[0];

    // Extract text from all <w:t> elements (with or without attributes)
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const runs = [];
    let tMatch;
    while ((tMatch = tRegex.exec(pXml)) !== null) {
      // tMatch[1] is the text content, strip XML entities
      const text = tMatch[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      runs.push(text);
    }
    const line = runs.join('').trim();
    if (line) paragraphs.push(line);
  }

  return paragraphs.join('\n');
}

// ---------- PDF (lightweight extractor) ----------
async function parsePdf(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);

  // Convert to binary string
  let raw = '';
  for (let i = 0; i < bytes.length; i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const texts = [];

  // 1. Try uncompressed text (BT ... ET blocks)
  const btRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btRegex.exec(raw)) !== null) {
    const block = match[1];

    // Tj: (text) Tj
    for (const tj of block.matchAll(/\(([^)]*)\)\s*Tj/g)) {
      const t = decodePdfString(tj[1]).trim();
      if (t) texts.push(t);
    }

    // TJ: [(text1) num (text2) ...] TJ
    for (const tjArr of block.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      for (const str of tjArr[1].matchAll(/\(([^)]*)\)/g)) {
        const t = decodePdfString(str[1]).trim();
        if (t) texts.push(t);
      }
    }
  }

  // 2. If little text found, try FlateDecode decompression
  if (texts.length < 3) {
    const decompressed = await tryDecompressStreams(bytes, raw);
    texts.push(...decompressed);
  }

  const result = texts.join('\n');
  if (!result || result.length < 5) {
    throw new Error('PDF 解析结果为空，可能是扫描版或图片型 PDF，请复制粘贴简历文本');
  }
  return result;
}

function decodePdfString(str) {
  return str
    .replace(/\\([\\nrtfbf()])/g, (_, c) => {
      const m = { '\\': '\\', n: '\n', r: '\r', t: '\t', f: '\f', b: '\b', '(': '(', ')': ')' };
      return m[c] || c;
    })
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

async function tryDecompressStreams(bytes, raw) {
  const texts = [];
  const streamRegex = /\/Filter\s*\/FlateDecode[\s\S]*?stream[\s\r\n]+([\s\S]*?)endstream/g;
  let match;

  while ((match = streamRegex.exec(raw)) !== null) {
    try {
      const streamStart = match.index + match[0].indexOf('stream') + 6;
      let offset = streamStart;
      while (offset < raw.length && (raw[offset] === '\r' || raw[offset] === '\n')) offset++;

      const streamEnd = raw.indexOf('endstream', offset);
      if (streamEnd < 0) continue;

      // Trim trailing whitespace
      let end = streamEnd;
      while (end > offset && /\s/.test(raw[end - 1])) end--;
      if (end - offset < 4) continue;

      const compressed = new Uint8Array(end - offset);
      for (let i = 0; i < compressed.length; i++) {
        compressed[i] = raw.charCodeAt(offset + i) & 0xff;
      }

      // PDF uses raw deflate (RFC 1951). Try raw first, zlib as fallback.
      for (const fmt of ['deflate-raw', 'deflate']) {
        try {
          const result = await decompressChunk(compressed, fmt);
          if (result) {
            for (const bt of result.matchAll(/BT([\s\S]*?)ET/g)) {
              for (const tj of bt[1].matchAll(/\(([^)]*)\)\s*Tj/g)) {
                const t = decodePdfString(tj[1]).trim();
                if (t) texts.push(t);
              }
            }
            break; // success, stop trying formats
          }
        } catch { /* next format */ }
      }
    } catch { /* skip bad stream */ }
  }
  return texts;
}

function decompressChunk(compressed, format) {
  return new Promise((resolve, reject) => {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      let result = '';
      reader.read().then(function pump({ done, value }) {
        if (done) { resolve(result); return; }
        result += new TextDecoder().decode(value);
        reader.read().then(pump, reject);
      }, reject);
      writer.write(compressed).then(() => writer.close(), reject).catch(reject);
    } catch (e) { reject(e); }
  });
}

// ---------- Unified interface ----------

/**
 * Parse a file and return extracted plain text.
 * @param {File} file - Browser File object
 * @returns {Promise<{text: string, ext: string, charCount: number}>}
 */
export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const arrayBuffer = await file.arrayBuffer();
  let text = '';

  switch (ext) {
    case 'txt':
    case 'md':
      text = await parseTxt(arrayBuffer);
      break;
    case 'docx':
    case 'doc':
      text = await parseDocx(arrayBuffer);
      break;
    case 'pdf':
      text = await parsePdf(arrayBuffer);
      break;
    default:
      throw new Error(`不支持的文件格式：.${ext}。支持 .docx / .pdf / .txt`);
  }

  const charCount = text.length;
  return { text, ext, charCount };
}

/**
 * Clean clipboard text for direct pasting.
 */
export function extractTextFromClipboard(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
