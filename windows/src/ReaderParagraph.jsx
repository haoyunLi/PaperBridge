import React from 'react';
import './reader-paragraph.css';

function LanguageLabel({ title, language }) {
  return <div className="reader-language-label"><strong>{title}</strong><span>{language}</span></div>;
}

export default function ReaderParagraph({ sourceLanguage, targetLanguage, status, original, translation }) {
  // Keep labels outside selectable passages so stored text offsets stay valid.
  return <>
    <div className="reader-source-side">
      <LanguageLabel title="ORIGINAL" language={sourceLanguage} />
      {original}
    </div>
    {translation && <>
      <div className={`reader-side-divider ${status === 'ok' ? 'translated' : ''}`} aria-hidden="true" />
      <div className={`reader-translation-side ${status === 'ok' ? 'translated' : ''}`}>
        <LanguageLabel title="TRANSLATION" language={targetLanguage} />
        {translation}
      </div>
    </>}
  </>;
}
