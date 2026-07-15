/**
 * Hand-labeled eval set (build guide §5.7). Synthetic but realistic emails, each with the
 * bucket a careful human would pick. Synthetic on purpose: privacy-safe, reproducible, and
 * safe to commit to a public repo — a reviewer can run `npm run eval` and get the same number.
 *
 * `expected` is always a DEFAULT bucket name. A few fixtures are deliberately borderline
 * (receipts, security alerts) and flagged with `note` — these are where a secondary bucket or a
 * miss is reasonable, and where the eval earns an honest (< 100%) accuracy number.
 *
 * This is also the seed of a production feedback loop: when a user manually moves an email to a
 * different bucket, that (email, correctedBucket) pair is exactly a new fixture to append here.
 */
export interface EvalFixture {
  subject: string;
  from: string;
  snippet: string;
  expected: string;
  note?: string;
}

export const EVAL_FIXTURES: readonly EvalFixture[] = [
  // --- Important: from a person, needs a reply / has a deadline / requires action ---
  {
    subject: 'Re: Contract review — need your sign-off by Friday',
    from: 'Sarah Chen <sarah@meridianlaw.com>',
    snippet:
      'Following up on the MSA — we need your signature before Friday EOD to close on time. Let me know if anything looks off.',
    expected: 'Important',
  },
  {
    subject: 'Can we move our 1:1 to 3pm?',
    from: 'Marcus Lee <marcus@company.com>',
    snippet: 'Something came up this morning. Are you free at 3 instead? Let me know and I’ll send an invite.',
    expected: 'Important',
  },
  {
    subject: 'Checkout is throwing 500s in prod',
    from: 'Priya Nair <priya@company.com>',
    snippet: 'The checkout service started erroring about 10 minutes ago. Can you jump on the incident call?',
    expected: 'Important',
  },
  {
    subject: 'Question about the Q3 budget line',
    from: 'David Osei <david.osei@company.com>',
    snippet: 'Quick one — did the marketing spend move under ops this quarter? I need it for the board deck tomorrow.',
    expected: 'Important',
  },

  // --- Can Wait: legitimate but not time-sensitive (FYI, receipt, confirmation) ---
  {
    subject: 'Notes from today’s standup',
    from: 'Alex Kim <alex@company.com>',
    snippet: 'Sharing notes for anyone who missed it. No action items for you — just keeping you in the loop.',
    expected: 'Can Wait',
  },
  {
    subject: 'Receipt from Blue Bottle Coffee',
    from: 'Square <receipts@messaging.squareup.com>',
    snippet: 'You paid $6.50 at Blue Bottle Coffee. Thanks for stopping by!',
    expected: 'Can Wait',
    note: 'Borderline with Auto-archive — a transactional receipt the user might want to keep.',
  },
  {
    subject: 'Your package has shipped',
    from: 'Amazon.com <ship-confirm@amazon.com>',
    snippet: 'Your order of "USB-C to USB-C cable (2m)" is on the way and should arrive Thursday.',
    expected: 'Can Wait',
    note: 'Borderline with Auto-archive.',
  },
  {
    subject: 'December account statement is ready',
    from: 'Chase <no.reply.statements@chase.com>',
    snippet: 'Your December statement is now available to view online. No action is required.',
    expected: 'Can Wait',
    note: 'Borderline with Auto-archive.',
  },

  // --- Newsletter: subscribed bulk reading content ---
  {
    subject: 'The Batch: this week in AI',
    from: 'DeepLearning.AI <thebatch@deeplearning.ai>',
    snippet: 'This week: new open-weight models, a chip-supply update, and three papers worth your time.',
    expected: 'Newsletter',
  },
  {
    subject: 'Morning Brew ☕ Markets climb',
    from: 'Morning Brew <crew@morningbrew.com>',
    snippet: 'Good morning. Stocks rallied yesterday on cooler inflation data. Here’s what you need to know.',
    expected: 'Newsletter',
  },
  {
    subject: 'Stratechery: The End of the Beginning',
    from: 'Ben Thompson <ben@stratechery.com>',
    snippet: 'Today’s article looks at platform maturity and what comes after the current wave of consolidation.',
    expected: 'Newsletter',
  },
  {
    subject: 'Your weekly digest from the writers you follow',
    from: 'Substack <no-reply@substack.com>',
    snippet: 'Five new posts this week from the publications you subscribe to. Tap to read.',
    expected: 'Newsletter',
  },

  // --- Promotions: marketing / sales / deals ---
  {
    subject: '🔥 48-hour flash sale — 40% off everything',
    from: 'Nike <nike@official.nike.com>',
    snippet: 'Our biggest sale of the season ends Sunday night. Shop now and take 40% off sitewide.',
    expected: 'Promotions',
  },
  {
    subject: 'You left something in your cart',
    from: 'Warby Parker <hello@warbyparker.com>',
    snippet: 'Your frames are still waiting. Complete your order today and shipping is on us.',
    expected: 'Promotions',
  },
  {
    subject: 'Last chance: 3 months of Premium, free',
    from: 'Spotify <no-reply@spotify.com>',
    snippet: 'Upgrade today and get 3 months of Premium free. This offer ends at midnight.',
    expected: 'Promotions',
  },

  // --- Auto-archive: low-value automated, no-reply, routine ---
  {
    subject: 'Security alert: new sign-in on Chrome',
    from: 'Google <no-reply@accounts.google.com>',
    snippet: 'We noticed a new sign-in to your Google Account on a Windows device. If this was you, no action is needed.',
    expected: 'Auto-archive',
    note: 'Borderline with Important if the sign-in were unexpected; routine as written.',
  },
  {
    subject: '[dependabot] Bump lodash from 4.17.20 to 4.17.21',
    from: 'GitHub <notifications@github.com>',
    snippet: 'This is an automated pull request opened by Dependabot to update a dependency. No response required.',
    expected: 'Auto-archive',
  },
  {
    subject: 'Your daily cron job completed successfully',
    from: 'Backups <no-reply@backups.internal>',
    snippet: 'Automated notice: nightly backup finished with status OK. This message is sent for every run.',
    expected: 'Auto-archive',
  },
];
