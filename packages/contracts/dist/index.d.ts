import { z } from 'zod';
export declare const PASSWORD_MIN_LENGTH = 12;
export declare const PASSWORD_MAX_LENGTH = 200;
export declare const DISPLAY_NAME_MIN_LENGTH = 1;
export declare const DISPLAY_NAME_MAX_LENGTH = 100;
export declare const passwordSchema: z.ZodString;
export declare const displayNameSchema: z.ZodString;
export declare const registrationSchema: z.ZodObject<{
    displayName: z.ZodString;
    email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    password: z.ZodString;
}, z.core.$strip>;
export declare const jobIdSchema: z.ZodString;
export declare const rangeSchema: z.ZodObject<{
    start: z.ZodNumber;
    end: z.ZodNumber;
}, z.core.$strip>;
export declare const rangesSchema: z.ZodObject<{
    selection_mode: z.ZodDefault<z.ZodEnum<{
        automatic: "automatic";
        manual: "manual";
        range: "range";
        visual: "visual";
    }>>;
    selected_blocks: z.ZodOptional<z.ZodArray<z.ZodString>>;
    start_order: z.ZodOptional<z.ZodNumber>;
    end_order: z.ZodOptional<z.ZodNumber>;
    visual_ranges: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    include_headings: z.ZodOptional<z.ZodBoolean>;
    include_captions: z.ZodOptional<z.ZodBoolean>;
    include_table_headers: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const rangeDraftSchema: z.ZodObject<{
    visual_ranges: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    manual_only: z.ZodOptional<z.ZodBoolean>;
    prompt: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const rangeExportSchema: z.ZodObject<{
    session_id: z.ZodString;
    replacements: z.ZodOptional<z.ZodArray<z.ZodString>>;
    edited_texts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$loose>;
export declare const rangeContinueSchema: z.ZodObject<{
    session_id: z.ZodString;
    replacements: z.ZodOptional<z.ZodArray<z.ZodString>>;
    edited_texts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$loose>;
export declare const rewriteRequestSchema: z.ZodObject<{
    profile: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>]>>;
    profile_id: z.ZodOptional<z.ZodString>;
    intensity: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const validationRequestSchema: z.ZodObject<{
    edited_texts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    text: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const reinsertionRequestSchema: z.ZodObject<{
    edited_texts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    text: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const textRewriteRequestSchema: z.ZodObject<{
    text: z.ZodString;
    profile: z.ZodOptional<z.ZodString>;
    intensity: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const textDetectionRequestSchema: z.ZodObject<{
    text: z.ZodString;
}, z.core.$loose>;
export declare const formattingApplyRequestSchema: z.ZodObject<{
    settings: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
}, z.core.$loose>;
export declare const openAiRangeEditSchema: z.ZodObject<{
    visual_ranges: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    prompt: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    manual_only: z.ZodOptional<z.ZodLiteral<false>>;
}, z.core.$loose>;
export declare const progressStateSchema: z.ZodEnum<{
    queued: "queued";
    extracting: "extracting";
    rewriting: "rewriting";
    validating: "validating";
    reinserting: "reinserting";
    complete: "complete";
    failed: "failed";
}>;
export declare const errorResponseSchema: z.ZodObject<{
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        issues: z.ZodOptional<z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    requestId: z.ZodString;
}, z.core.$strip>;
export declare const jobResponseSchema: z.ZodObject<{
    job_id: z.ZodString;
    state: z.ZodOptional<z.ZodEnum<{
        queued: "queued";
        extracting: "extracting";
        rewriting: "rewriting";
        validating: "validating";
        reinserting: "reinserting";
        complete: "complete";
        failed: "failed";
    }>>;
}, z.core.$loose>;
export declare const legacyHtmlResponseSchema: z.ZodObject<{
    representation: z.ZodLiteral<"legacy-html">;
    content_type: z.ZodString;
    html: z.ZodString;
}, z.core.$strip>;
export type RangeSelectionRequest = z.infer<typeof rangesSchema>;
export type RangeEditRequest = z.infer<typeof openAiRangeEditSchema>;
export type RewriteRequest = z.infer<typeof rewriteRequestSchema>;
export type ValidationRequest = z.infer<typeof validationRequestSchema>;
export type ReinsertionRequest = z.infer<typeof reinsertionRequestSchema>;
export type TextRewriteRequest = z.infer<typeof textRewriteRequestSchema>;
export type TextDetectionRequest = z.infer<typeof textDetectionRequestSchema>;
export type FormattingApplyRequest = z.infer<typeof formattingApplyRequestSchema>;
export type ProgressState = z.infer<typeof progressStateSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type LegacyHtmlResponse = z.infer<typeof legacyHtmlResponseSchema>;
