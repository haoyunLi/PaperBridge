const headingNames = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(abstract|introduction|background|related work|methods?|methodology|materials and methods|results?|experiments?|evaluation|discussion|limitations?|conclusions?|references|bibliography|appendix|摘要|引言|方法|结果|讨论|结论)\s*$/i;

export function isHeading(text) {
  const value = text.trim();
  return !!value && value.length < 100 && (headingNames.test(value) || /^\d+(?:\.\d+){0,3}\s+[A-Z][\w ,:&-]{2,80}$/.test(value));
}

export function cleanLine(value) {
  return value.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}

export function blocksFromText(text) {
  return text.replace(/\r/g, '\n').split(/\n\s*\n/).map(part => part.split('\n').map(cleanLine).filter(Boolean).join(' ')).filter(Boolean)
    .map((value, index) => ({ id: index + 1, text: value, page: null, heading: isHeading(value), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }));
}

export function joinLines(lines) {
  let text = '';
  for (const line of lines) {
    const value = cleanLine(line.text || line);
    if (!value) continue;
    if (!text) text = value;
    else if (text.endsWith('-') && /^[a-z]/.test(value)) text = text.slice(0, -1) + value;
    else text += ' ' + value;
  }
  return text.trim();
}

export function blocksFromLines(lines, pageNumber, startId = 1, preserveOrder = false) {
  const sorted = [...lines].filter(line => cleanLine(line.text));
  if (!preserveOrder) sorted.sort((a, b) => b.y - a.y || a.x - b.x);
  const blocks = [];
  let group = [];
  const flush = () => {
    const text = joinLines(group);
    if (text) blocks.push({ id: startId + blocks.length, text, page: pageNumber, heading: isHeading(text), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] });
    group = [];
  };
  const widths = sorted.map(line => line.height || 12).sort((a, b) => a - b);
  const typicalHeight = widths[Math.floor(widths.length / 2)] || 12;
  for (const line of sorted) {
    const previous = group[group.length - 1];
    const gap = previous ? previous.y - line.y : 0;
    const heading = isHeading(line.text);
    const nextStarts = /^[A-Z\u4e00-\u9fff]/.test(line.text);
    const previousEnds = previous && /[.!?。！？:]$/.test(previous.text);
    if (previous && (heading || isHeading(previous.text) || gap > typicalHeight * 1.8 || gap < -typicalHeight * 3 || (previousEnds && nextStarts && gap > typicalHeight * 1.1))) flush();
    group.push(line);
    if (heading) flush();
  }
  flush();
  return blocks;
}

export function readingMap(blocks) {
  const sections = blocks.filter(block => block.heading);
  const topics = [
    ['Research question', /abstract|introduction|background|摘要|引言/i],
    ['Approach', /method|approach|方法/i],
    ['Evidence', /result|experiment|evaluation|结果|实验/i],
    ['Interpretation', /discussion|limitation|讨论|局限/i],
    ['Conclusion', /conclusion|结论/i]
  ];
  const matches = topics.map(([label, pattern]) => {
    const section = sections.find(block => pattern.test(block.text));
    if (!section) return null;
    const end = sections.find(block => block.id > section.id)?.id || Infinity;
    const passage = blocks.find(block => block.id > section.id && block.id < end && block.text.length >= 40);
    return passage ? { label, section: section.text, blockId: passage.id, excerpt: passage.text } : null;
  }).filter(Boolean);
  if (matches.length) return matches;
  const first = blocks.find(block => block.text.length >= 40);
  return first ? [{ label: 'Start reading', section: 'Opening passage', blockId: first.id, excerpt: first.text }] : [];
}

export function chunkText(text, maxLength = 1800) {
  if (text.length <= maxLength) return [text];
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxLength) { chunks.push(current.trim()); current = ''; }
    if (sentence.length > maxLength) {
      for (let i = 0; i < sentence.length; i += maxLength) chunks.push(sentence.slice(i, i + maxLength).trim());
    } else current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}
