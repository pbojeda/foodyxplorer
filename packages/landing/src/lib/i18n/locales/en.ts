import type { Dictionary } from './es';

export const en: Dictionary = {
  hero: {
    eyebrow: 'Know what you eat',
    headlineA: 'Eat out with peace of mind',
    headlineB: 'Know what you eat. Dine out without guessing.',
    subtitleA:
      'The clearest way to understand what you are eating at Spanish restaurants: calories, macros, and confidence level visible before you decide.',
    subtitleB:
      'Nutritional information for Spanish restaurants with real traceability. Calories, macros, and confidence in every dish.',
    cta: 'I want to try it',
    microcopy: 'No spam. No commitments. We will notify you when we launch.',
    trustPills: ['Verified data', 'Visible confidence', 'Made in Spain'],
  },
  variants: {
    a: {
      hero: {
        eyebrow: 'Know what you eat',
        headline: 'Eat out without going blind.',
        subtitle:
          'Enjoy eating out with more context and less improvisation. Calories, macros, and visible confidence level before deciding.',
        supporting: 'No spam. Launch and early access only.',
      },
    },
    c: {
      hero: {
        eyebrow: 'The problem nobody has solved',
        headline: 'When you eat out, you decide blind.',
        subtitle:
          'You do not know how many calories a dish has. You do not know if the data is reliable. And with allergies, improvising is not an option.',
        scrollCta: 'See how we solve it',
      },
    },
    d: {
      hero: {
        eyebrow: 'Try it now',
        headline: 'Search any dish. See what you know.',
        subtitle:
          'Type a dish and discover calories, macros, and confidence level.',
      },
    },
    f: {
      hero: {
        eyebrow: 'For families with food allergies',
        headline: 'Eat out without fear.',
        subtitle:
          'Verified allergens in Spanish restaurants. If there is no official data, we do not take chances.',
      },
    },
  },
  postSimulatorCta: {
    headline: 'Do you like what you see?',
    subtitle: 'Sign up to access when we launch.',
  },
  problem: {
    eyebrow: 'The problem',
    headline: 'When you eat out, you decide almost blind',
    p1: 'You know exactly what you eat at home. You have the ingredients, the proportions, the control. But when you walk into a restaurant, that clarity disappears.',
    p2: 'You do not know how many calories the dish has. You do not know if the information you find online is from that specific restaurant or a completely different one. You do not know if there is an allergen risk. And if you track nutrition, you just give up for that day.',
    p3: 'It should not be this hard. Eating out is part of life, not an exception to manage with anxiety.',
  },
  howItWorks: {
    eyebrow: 'How it works',
    headline: 'Three steps. No complications.',
    steps: [
      {
        title: 'Search a dish',
        description:
          'Type the dish name or restaurant in our Telegram bot or on the web. No apps to install.',
      },
      {
        title: 'Understand the answer',
        description:
          'Calories, macros, main ingredients, and the data confidence level: verified, estimated, or inferred. You always know what you can rely on.',
      },
      {
        title: 'Decide with context',
        description:
          'Choose with more information and less anxiety. No need to be perfect: just have more clarity to make better decisions.',
      },
    ],
  },
  trustEngine: {
    eyebrow: 'Trust engine',
    headline: 'Not all data is equal. We tell you which.',
    subtitle:
      'nutriXplorer does not fake precision where there is none. Every data point carries its visible confidence level, so you know exactly what you can rely on.',
    levels: [
      {
        badge: 'high' as 'high' | 'medium' | 'low',
        badgeLabel: 'HIGH CONFIDENCE',
        title: 'Verified',
        description:
          'Data confirmed directly with the restaurant or from official sources with certified nutritional information. The most reliable.',
      },
      {
        badge: 'medium' as 'high' | 'medium' | 'low',
        badgeLabel: 'MEDIUM CONFIDENCE',
        title: 'Estimated',
        description:
          'Calculated from standard recipes, reference nutritional databases, and known preparation patterns. Useful for clear guidance.',
      },
      {
        badge: 'low' as 'high' | 'medium' | 'low',
        badgeLabel: 'LOW CONFIDENCE',
        title: 'Inferred',
        description:
          'Based on similarity with analogous dishes when no more precise data is available. Transparent about its limitations.',
      },
    ],
    allergenTitle: 'Allergen guard',
    allergenDescription:
      'When allergen data is not verified, we clearly indicate it. We never assume something is safe if we have not checked.',
  },
  forWho: {
    eyebrow: 'Who it is for',
    headline: 'Do you recognize yourself here?',
    profiles: [
      {
        title: 'You watch what you eat',
        description:
          'You track nutrition or simply want to know what goes in. Eating out should not be a black hole in your log.',
      },
      {
        title: 'You manage allergens',
        description:
          'You or someone in your family has an allergy or intolerance. You need certainty, not assumptions, before choosing a dish.',
      },
      {
        title: 'You care about your health',
        description:
          'You have a health goal or follow a dietary plan. You want to keep enjoying meals out without abandoning your journey.',
      },
      {
        title: 'You eat out often',
        description:
          'Meetings, set menus, social commitments. You need quick, informed decisions without making a scene at the table.',
      },
    ],
  },
  emotionalBlock: {
    headline: 'What would eating out with more calm feel like?',
    quote: '"Finally, I can go out to eat with my family without constant fear of allergens."',
    quoteAuthor: 'Beta user, Madrid',
    scenarios: [
      {
        scene: 'Reading the menu',
        description:
          'You open the menu and understand what is happening in that dish. No need to guess, compare with vague memories, or give up what you feel like eating.',
      },
      {
        scene: 'In a group, no friction',
        description:
          'You choose without having to explain anything, justify anything, or feel different. The information is there; the decision is yours.',
      },
      {
        scene: 'The set lunch menu',
        description:
          'That moment when they ask what you want and you have ten seconds to decide. With nutriXplorer, you already know before you arrive.',
      },
    ],
  },
  comparison: {
    headline: 'Why not use what already exists?',
    cards: [
      {
        title: 'Fitness apps',
        versus: 'MyFitnessPal, Cronometer...',
        description:
          'Great for packaged foods and home cooking. But when you search for a specific Spanish restaurant dish, the result is empty, inaccurate, or from another continent.',
        advantage: 'nutriXplorer focuses on real Spanish restaurants.',
      },
      {
        title: 'Restaurant apps',
        versus: 'TheFork, Yelp, Google Maps...',
        description:
          'They tell you where to go and how the food is. They do not tell you the nutritional content or the reliability level of the data.',
        advantage: 'nutriXplorer adds the missing nutritional layer.',
      },
      {
        title: 'Guessing',
        versus: '"I think it is around 600 kcal..."',
        description:
          'The most widely used option. Fast, free, completely unreliable. And it generates guilt when the result does not match your goals.',
        advantage: 'nutriXplorer gives you a real reference point.',
      },
    ],
  },
  productDemo: {
    eyebrow: 'What a real query looks like',
    headline: 'More real product, less abstract promise',
    subtitle:
      'The experience is designed for the exact moment of deciding: you type, you understand where the data comes from, and you choose with more context.',
  },
  searchSimulator: {
    eyebrow: 'Interactive demo',
    headline: 'You get it in 10 seconds',
    subtitle:
      'More than a number: an answer that tells you what it knows, where it knows it from, and when it should not present itself as verified.',
  },
  restaurants: {
    eyebrow: 'Where it works',
    headline: 'Restaurants across Spain',
    subtitle:
      'From chains with official data to your neighborhood bar. nutriXplorer adjusts confidence to the available data.',
    items: [
      { label: 'National chains', note: 'Official data' },
      { label: 'Traditional cuisine', note: 'Smart estimation' },
      { label: 'Local restaurants', note: 'Inferred by similarity' },
    ],
  },
  audienceGrid: {
    eyebrow: 'Who is starting today',
    headline: 'Who is starting today',
  },
  waitlistCta: {
    headline: 'Be the first to try it',
    subtitle:
      'nutriXplorer is in development. Join the waitlist and be among the first to access it when we launch.',
    urgency: 'Limited spots for early access',
    trustNote: 'No spam. No commitments. We only notify you when we launch.',
  },
  footer: {
    tagline: 'Know what you eat. Eat out with peace of mind.',
    links: {
      privacy: 'Privacy policy',
      cookies: 'Cookie policy',
      legal: 'Legal notice',
    },
    madeIn: 'Made in Spain',
    copyright: '© 2026 nutriXplorer. All rights reserved.',
  },
};
