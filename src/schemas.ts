import { z } from 'zod';

// Zendesk timestamps are ISO-8601 datetimes, but we keep the validation
// permissive (plain string) so a format drift on Zendesk's side never breaks
// retrieval. Named to reflect what it actually is.
const dateTimeString = z.string();

export const CategorySchema = z.object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable().default(''),
    locale: z.string(),
    html_url: z.string().url(),
    position: z.number().int().optional(),
    created_at: dateTimeString,
    updated_at: dateTimeString,
    outdated: z.boolean().optional()
});
export type Category = z.infer<typeof CategorySchema>;

export const SectionSchema = z.object({
    id: z.number().int(),
    category_id: z.number().int(),
    name: z.string(),
    description: z.string().nullable().default(''),
    locale: z.string(),
    html_url: z.string().url(),
    parent_section_id: z.number().int().nullable().optional(),
    position: z.number().int().optional(),
    created_at: dateTimeString,
    updated_at: dateTimeString,
    outdated: z.boolean().optional()
});
export type Section = z.infer<typeof SectionSchema>;

export const ArticleSchema = z.object({
    id: z.number().int(),
    section_id: z.number().int().nullable().optional(),
    title: z.string(),
    name: z.string().optional(),
    body: z.string().nullable().default(''),
    html_url: z.string().url(),
    locale: z.string(),
    draft: z.boolean().optional(),
    promoted: z.boolean().optional(),
    position: z.number().int().optional(),
    vote_sum: z.number().int().optional(),
    vote_count: z.number().int().optional(),
    label_names: z.array(z.string()).default([]),
    created_at: dateTimeString,
    updated_at: dateTimeString,
    edited_at: dateTimeString.optional(),
    outdated: z.boolean().optional()
});
export type Article = z.infer<typeof ArticleSchema>;

export const ArticleSearchHitSchema = ArticleSchema.extend({
    snippet: z.string().optional(),
    result_type: z.literal('article').optional(),
    score: z.number().optional()
});
export type ArticleSearchHit = z.infer<typeof ArticleSearchHitSchema>;

const PaginationSchema = z.object({
    page: z.number().int(),
    page_count: z.number().int(),
    per_page: z.number().int(),
    count: z.number().int(),
    next_page: z.string().url().nullable(),
    previous_page: z.string().url().nullable()
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const CategoriesPageSchema = PaginationSchema.extend({
    categories: z.array(CategorySchema)
});
export type CategoriesPage = z.infer<typeof CategoriesPageSchema>;

export const SectionsPageSchema = PaginationSchema.extend({
    sections: z.array(SectionSchema)
});
export type SectionsPage = z.infer<typeof SectionsPageSchema>;

export const ArticlesPageSchema = PaginationSchema.extend({
    articles: z.array(ArticleSchema)
});
export type ArticlesPage = z.infer<typeof ArticlesPageSchema>;

export const SearchPageSchema = PaginationSchema.extend({
    results: z.array(ArticleSearchHitSchema)
});
export type SearchPage = z.infer<typeof SearchPageSchema>;

export const ArticleEnvelopeSchema = z.object({ article: ArticleSchema });
