---
doc_id: DOCOO-EXTERNAL-ADAPTERS
title: قرارداد آداپترهای بیرونی
status: proposed
version: 1.0.0
owner: Platform Architecture
last_updated: 2026-09-24
notion_sync: true
---

# قرارداد آداپترهای بیرونی

## ۱. قواعد مشترک

هر integration پشت port داخلی است، timeout/cancellation، health، normalized error، telemetry، idempotency و policy metadata دارد. SDK object از boundary بیرون نمی‌آید.

## ۲. AI provider

قرارداد در سند provider تعریف شده است. adapter باید model discovery، invocation، tool mapping، usage، retention capability و error classification را پیاده کند.

## ۳. Research/Search

```ts
interface ResearchSourceAdapter {
  search(query: SearchQuery): Promise<SearchResultPage>;
  fetch(ref: SourceRef): Promise<FetchedSource>;
  robotsAndPolicy(ref: SourceRef): Promise<AccessDecision>;
}
```

Adapter محتوا را trusted نمی‌کند. URL final، redirect chain، accessed time، headers محدود و content digest ثبت می‌شوند.

## ۴. Object storage

```ts
interface BlobStore {
  createUpload(intent: UploadIntent): Promise<SignedUpload>;
  stat(key: string): Promise<BlobMetadata>;
  open(key: string): Promise<Readable>;
  copy(source: string, target: string): Promise<void>;
  deleteVersion(key: string, version?: string): Promise<void>;
}
```

Bucket/key توسط server ساخته می‌شود؛ client path دلخواه نمی‌دهد.

## ۵. Extraction/OCR/Transcription

Output مشترک `ExtractedDocument` با blocks، locator، language، confidence، warnings و engine version. Adapter باید partial را از success کامل جدا کند. transcription segment timestamp و speaker nullable دارد.

## ۶. Renderer

```ts
interface DocumentRenderer {
  supports(format: ArtifactFormat): boolean;
  render(source: StructuredDocument, template: TemplateVersion): Promise<RenderedArtifact>;
  validate(artifact: RenderedArtifact): Promise<ArtifactValidation>;
}
```

Renderer network access ندارد و assetها reference مجاز داخلی‌اند.

## ۷. Notion publisher

قرارداد create/update/archive page، block conversion، rate limit و idempotency. Publisher فقط docs manifest را می‌بیند، نه دادهٔ پروژه‌های مشتری.

## ۸. خطا

طبقه‌بندی مشترک:

- `TRANSIENT_NETWORK`
- `RATE_LIMITED`
- `AUTHENTICATION_FAILED`
- `AUTHORIZATION_DENIED`
- `INVALID_REQUEST`
- `UNSUPPORTED_CAPABILITY`
- `CONTENT_REJECTED`
- `QUOTA_EXCEEDED`
- `PROVIDER_OUTAGE`
- `INTERNAL_ADAPTER_ERROR`

فقط سه مورد transient/rate/provider outage retry خودکار دارند. auth/config نیازمند ادمین است.

## ۹. contract test

هر adapter fixtureهای success، stream، tool، timeout، rate-limit، malformed response، partial usage و redaction دارد. live smoke در CI عمومی اجرا نمی‌شود.
