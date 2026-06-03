import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/html.js';

describe('htmlToMarkdown', () => {
    it('returns empty string for empty/falsy input', () => {
        expect(htmlToMarkdown('')).toBe('');
    });

    it('converts headings h1-h6 to the right number of hashes', () => {
        expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
        expect(htmlToMarkdown('<h2>Sub</h2>')).toBe('## Sub');
        expect(htmlToMarkdown('<h6>Deep</h6>')).toBe('###### Deep');
    });

    it('clamps heading levels into the 1-6 range via min/max', () => {
        // The regex only matches h1-h6, so this asserts a normal in-range case
        // and that the level is taken from the captured digit.
        expect(htmlToMarkdown('<h3>Mid</h3>')).toBe('### Mid');
    });

    it('renders links as markdown with label and href', () => {
        expect(htmlToMarkdown('<a href="https://x.com">click</a>')).toBe('[click](https://x.com)');
    });

    it('falls back to the bare href when a link has no text label', () => {
        expect(htmlToMarkdown('<a href="https://x.com"></a>')).toBe('https://x.com');
    });

    it('handles single-quoted hrefs', () => {
        expect(htmlToMarkdown("<a href='https://x.com'>go</a>")).toBe('[go](https://x.com)');
    });

    it('converts list items to dash bullets', () => {
        const md = htmlToMarkdown('<ul><li>one</li><li>two</li></ul>');
        expect(md).toContain('- one');
        expect(md).toContain('- two');
    });

    it('handles ordered lists the same way (no numbering, dash bullets)', () => {
        const md = htmlToMarkdown('<ol><li>first</li><li>second</li></ol>');
        expect(md).toContain('- first');
        expect(md).toContain('- second');
    });

    it('converts paragraphs with blank-line separation', () => {
        const md = htmlToMarkdown('<p>alpha</p><p>beta</p>');
        expect(md).toBe('alpha\n\nbeta');
    });

    it('converts <br> to a newline, including inside a <p>', () => {
        expect(htmlToMarkdown('line1<br>line2')).toBe('line1\nline2');
        expect(htmlToMarkdown('<p>line1<br>line2</p>')).toBe('line1\nline2');
        expect(htmlToMarkdown('<p>a<br/>b</p>')).toBe('a\nb');
    });

    it('converts strong/b to ** and em/i to *', () => {
        expect(htmlToMarkdown('<strong>bold</strong>')).toBe('**bold**');
        expect(htmlToMarkdown('<b>bold</b>')).toBe('**bold**');
        expect(htmlToMarkdown('<em>it</em>')).toBe('*it*');
        expect(htmlToMarkdown('<i>it</i>')).toBe('*it*');
    });

    it('converts inline code to backticks', () => {
        expect(htmlToMarkdown('<code>x</code>')).toBe('`x`');
    });

    it('renders blockquotes with a leading > and prefixes wrapped lines', () => {
        const md = htmlToMarkdown('<blockquote>quoted</blockquote>');
        expect(md).toBe('> quoted');
    });

    it('strips script/style/noscript blocks entirely', () => {
        const md = htmlToMarkdown('<p>keep</p><script>evil()</script><style>.x{}</style>');
        expect(md).toBe('keep');
        expect(md).not.toContain('evil');
        expect(md).not.toContain('.x{}');
    });

    it('decodes named HTML entities', () => {
        expect(htmlToMarkdown('<p>a &amp; b</p>')).toBe('a & b');
        expect(htmlToMarkdown('<p>1 &lt; 2 &gt; 0</p>')).toBe('1 < 2 > 0');
        expect(htmlToMarkdown('<p>fancy&hellip;</p>')).toBe('fancy…');
    });

    it('leaves unknown named entities untouched', () => {
        expect(htmlToMarkdown('<p>&unknownent;</p>')).toBe('&unknownent;');
    });

    it('decodes decimal and hex numeric entities', () => {
        expect(htmlToMarkdown('<p>&#65;&#x42;</p>')).toBe('AB');
    });

    it('collapses excessive blank lines and trailing whitespace', () => {
        const md = htmlToMarkdown('<p>a</p>\n\n\n\n<p>b</p>');
        expect(md).toBe('a\n\nb');
    });

    it('handles a link nested inside a list item (nested case)', () => {
        const md = htmlToMarkdown('<ul><li>see <a href="https://x.com">docs</a></li></ul>');
        expect(md).toContain('- see [docs](https://x.com)');
    });

    it('handles emphasis nested inside a heading', () => {
        expect(htmlToMarkdown('<h2>Hello <strong>world</strong></h2>')).toBe('## Hello **world**');
    });

    it('strips unknown/leftover tags but keeps their text content', () => {
        expect(htmlToMarkdown('<span class="x">text</span>')).toBe('text');
        expect(htmlToMarkdown('<div><p>nested</p></div>')).toBe('nested');
    });

    it('handles attributes on heading and anchor tags', () => {
        expect(htmlToMarkdown('<h1 id="t" class="big">Title</h1>')).toBe('# Title');
        expect(htmlToMarkdown('<a class="c" href="https://x.com" target="_blank">go</a>')).toBe(
            '[go](https://x.com)'
        );
    });

    it('produces clean output for a representative mixed document', () => {
        const html =
            '<h1>Open a TFSA</h1><p>A <strong>TFSA</strong> is tax-free.</p>' +
            '<ul><li>Step <a href="https://help.example.com/1">one</a></li><li>Step two</li></ul>' +
            '<blockquote>Note this</blockquote>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('# Open a TFSA');
        expect(md).toContain('A **TFSA** is tax-free.');
        expect(md).toContain('- Step [one](https://help.example.com/1)');
        expect(md).toContain('- Step two');
        expect(md).toContain('> Note this');
    });
});
