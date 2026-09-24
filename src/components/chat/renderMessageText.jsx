import React from 'react';
import { normalizeExternalHttpsUrl } from '../../utils/urlSecurity';
import { parseInviteParam } from '../../utils/inviteLink';
import { splitTextBySearchQuery, escapeRegExp } from '../../utils/searchHighlight';

function highlightSearchQuery(text, query) {
  if (!query || !text || typeof text !== 'string') return text;
  const segments = splitTextBySearchQuery(text, query);
  if (segments.length <= 1 && !segments[0]?.isMatch) return text;
  return segments.map((seg, idx) => {
    if (seg.isMatch) {
      return (
        <mark key={idx} className="search-match-highlight">
          {seg.text}
        </mark>
      );
    }
    return seg.text;
  });
}

function renderMessageTextWithLinks(text, searchQuery = '') {
  if (!text) return null;
  const query = typeof searchQuery === 'string' ? searchQuery.trim() : '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      let href = part;
      let display = part;
      
      const trailingPunctuation = /[.,!?;)]+$/;
      const match = part.match(trailingPunctuation);
      let trailing = "";
      if (match) {
        trailing = match[0];
        href = part.substring(0, part.length - trailing.length);
        display = href;
      }

      const safeHref = normalizeExternalHttpsUrl(href);
      if (!safeHref) return highlightSearchQuery(part, query);

      const handleLinkClick = (e) => {
        e.stopPropagation();
        try {
          const parsed = new URL(safeHref);
          const invite = parseInviteParam(parsed);
          if (invite && typeof window !== 'undefined') {
            const isCoinyHost = parsed.origin === window.location.origin
              || parsed.hostname === 'mandyfan10-stack.github.io'
              || parsed.hostname === 'localhost';
            if (isCoinyHost) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('coiny:open-invite', { detail: { invite } }));
            }
          }
        } catch {
          // Ignore parse errors, proceed with standard link opening
        }
      };
      
      return (
        <React.Fragment key={i}>
          <a
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
          >
            {highlightSearchQuery(display, query)}
          </a>
          {trailing}
        </React.Fragment>
      );
    }
    return highlightSearchQuery(part, query);
  });
}

export { renderMessageTextWithLinks, highlightSearchQuery, escapeRegExp };
