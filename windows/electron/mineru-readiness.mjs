export function isMineruReady(parser) {
  if (!parser?.compatible || parser.runtime?.unusable) return false;
  // A custom legacy launcher can work even when its Python environment is unknown.
  return !(parser.kitExecutable && parser.runtime?.checked === false);
}
