import { characterPrefix, trimLibraryText } from './library-metadata.mjs';

export const styleGuideLimit = 2000;

export function savedStyleGuide(value) {
  return typeof value === 'string' ? characterPrefix(value.toWellFormed(), styleGuideLimit) : '';
}

export function promptStyleGuide(value) {
  return trimLibraryText(savedStyleGuide(value));
}

