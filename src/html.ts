/**
 * Minimal, dependency-free HTML → plain-text/markdown converter for Zendesk
 * article bodies. Preserves heading levels, list bullets, and link targets so
 * an LLM can reason about structure and follow citations.
 */

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    laquo: '«',
    raquo: '»',
    copy: '©',
    reg: '®',
    trade: '™'
};

function decodeEntities(input: string): string {
    return input
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

export function htmlToMarkdown(html: string): string {
    if (!html) return '';

    let body = html;

    // Strip script/style/noscript wholesale.
    body = body.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');

    // Headings -> markdown.
    body = body.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
        const hashes = '#'.repeat(Math.min(6, Math.max(1, Number(level))));
        return `\n\n${hashes} ${stripInline(inner)}\n\n`;
    });

    // Lists.
    body = body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${stripInline(inner)}`);
    body = body.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

    // Paragraphs and breaks.
    body = body.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner: string) => `\n\n${stripInline(inner)}\n\n`);
    body = body.replace(/<br\s*\/?>(?!\n)/gi, '\n');

    // Block quotes.
    body = body.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) =>
        `\n\n> ${stripInline(inner).replace(/\n/g, '\n> ')}\n\n`
    );

    // Anything else: strip remaining tags but keep link hrefs and inline emphasis.
    const text = stripInline(body);

    return collapseWhitespace(decodeEntities(text)).trim();
}

function stripInline(html: string): string {
    let text = html;
    // Markdown links [text](href)
    text = text.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
        const cleanLabel = stripAllTags(label).trim();
        if (!cleanLabel) return href;
        return `[${cleanLabel}](${href})`;
    });
    // Bold / emphasis.
    text = text.replace(/<\/?(strong|b)\b[^>]*>/gi, '**');
    text = text.replace(/<\/?(em|i)\b[^>]*>/gi, '*');
    text = text.replace(/<\/?code\b[^>]*>/gi, '`');
    return stripAllTags(text);
}

function stripAllTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
}

function collapseWhitespace(input: string): string {
    return input.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
}
