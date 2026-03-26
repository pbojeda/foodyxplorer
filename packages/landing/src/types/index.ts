export type Variant = 'a' | 'c' | 'd' | 'f';

export type Palette = 'botanical' | 'med';

export type Locale = 'es' | 'en';

export type WaitlistPayload = { email: string; phone?: string; variant: string; source: string };

export type WaitlistResponse = { success: boolean; error?: string };

export type AnalyticsEventName =
  | 'landing_view'
  | 'variant_assigned'
  | 'scroll_depth'
  | 'section_view'
  | 'hero_cta_click'
  | 'waitlist_cta_click'
  | 'waitlist_submit_start'
  | 'waitlist_submit_success'
  | 'waitlist_submit_error';

export type AnalyticsEventPayload = {
  event: AnalyticsEventName;
  variant: Variant;
  lang: Locale;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  [key: string]: unknown;
};

export type SectionId =
  | 'hero'
  | 'product-demo'
  | 'how-it-works'
  | 'trust-engine'
  | 'for-who'
  | 'emotional'
  | 'comparison'
  | 'restaurants'
  | 'waitlist-cta'
  | 'footer';
