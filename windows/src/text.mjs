const headingNames = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(abstract|introduction|background|related work|methods?|methodology|materials and methods|experimental setup|results?|experiments?|evaluation|discussion|limitations?|conclusions?|references|bibliography|appendix|acknowledg(?:e)?ments|摘要|引言|方法|结果|讨论|结论)\s*$/i;
const leadingNamedSection = /^(?:(?:\d+(?:\.\d+)*)\s+)?(?:abstract|introduction|background|related work|methods?|methodology|materials and methods|experimental setup|experiments?|evaluation|results?|discussion|conclusions?|appendix|acknowledg(?:e)?ments)(?:[.:])?\s+/i;

export function isHeading(text, sourceMarkdown = null) {
  const value = String(text || '').trim();
  const markdown = typeof sourceMarkdown === 'string' ? sourceMarkdown.trim() : '';
  if (markdown && !markdown.includes('\n') && !value.includes('\n') && value.length <= 200 && /^#{1,6}[ \t]+\S/.test(markdown)) return true;
  if (!value || value.includes('\n') || value.length > 120 || value.includes('@') || /[.!?]["')\]]?$/.test(value)) return false;
  const leading = value.match(leadingNamedSection)?.[0] || '';
  if (value.length >= 30 && leading && value.slice(leading.length).trim().length >= 20) return false;
  if (headingNames.test(value) || /^\d+(?:\.\d+)*\s+[A-Z].*$/.test(value)) return true;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 12) return false;
  const titleCaseWords = words.filter(word => /^\p{Lu}/u.test(word)).length;
  const letters = [...value].filter(character => /\p{L}/u.test(character));
  const uppercaseLetters = letters.filter(character => /\p{Lu}/u.test(character)).length;
  const uppercaseRatio = letters.length ? uppercaseLetters / letters.length : 0;
  return uppercaseRatio > 0.6 || titleCaseWords / words.length > 0.8;
}

export function cleanLine(value) {
  return value.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}

export function blocksFromText(text) {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(part => {
    const raw = part.trim();
    const value = raw.split('\n').map(cleanLine).filter(Boolean).join(' ');
    return value ? { raw, value } : null;
  }).filter(Boolean)
    .map(({ raw, value }, index) => ({ id: index + 1, text: value, page: null, heading: isHeading(raw), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }));
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
    const raw = group.map(line => cleanLine(line.text || line)).filter(Boolean).join('\n');
    if (text) blocks.push({ id: startId + blocks.length, text, page: pageNumber, heading: isHeading(raw), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] });
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
  const normalized = value => String(value || '').trim().toLowerCase()
    .replace(/^(?:\d+(?:\.\d+)*[.)]?|[ivx]+\.)\s+/i, '')
    .replace(/^[.:：\s]+|[.:：\s]+$/g, '');
  const sections = blocks.filter(block => block.heading && !block.resource);
  const topics = [
    { id: 'question', title: 'The research question', question: 'What problem does this paper address?', headings: ['abstract', 'introduction', 'background', '摘要', '引言', '背景'] },
    { id: 'method', title: 'The approach', question: 'How did the authors investigate it?', headings: ['method', 'methods', 'methodology', 'materials and methods', 'approach', 'model', 'architecture', '方法', '材料与方法'] },
    { id: 'evidence', title: 'The evidence', question: 'Which experiments support the claims?', headings: ['results', 'experiments', 'evaluation', 'experimental results', '结果', '实验'] },
    { id: 'limits', title: 'Interpretation and limits', question: 'Where should the conclusions be treated cautiously?', headings: ['limitations', 'discussion', 'limitations and discussion', '讨论', '局限性'] },
    { id: 'conclusion', title: 'The takeaway', question: 'What do the authors conclude?', headings: ['conclusion', 'conclusions', 'concluding remarks', '结论'] }
  ];
  const matches = topics.map(topic => {
    const section = sections.find(block => {
      const title = normalized(block.text);
      return topic.headings.some(name => title === name || title.startsWith(`${name}:`) || title.startsWith(`${name} and `));
    });
    if (!section) return null;
    const end = sections.find(block => block.id > section.id)?.id || Infinity;
    const passage = blocks.find(block => block.id >= section.id && block.id < end && !block.resource && block.text.trim().length >= 40 && normalized(block.text) !== normalized(section.text));
    return passage ? { id: topic.id, title: topic.title, question: topic.question, sectionTitle: section.text, paragraphID: passage.id, excerpt: passage.text } : null;
  }).filter(Boolean);
  if (matches.length) return matches;
  const first = blocks.find(block => !block.resource && String(block.text || '').trim().length >= 40);
  return first ? [{ id: 'beginning', title: 'Start at the beginning', question: 'Section headings were not identified reliably. Read the source before drawing conclusions.', sectionTitle: 'Opening passage', paragraphID: first.id, excerpt: first.text }] : [];
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
