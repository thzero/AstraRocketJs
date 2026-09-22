import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// Mirrors the old wiki Home.md index, which had to be maintained by hand.
//
// EVERY category is `collapsed: false`, and that is load-bearing twice over.
// On the site it is a taste call for a set this small: seventeen pages in four
// groups fit without scrolling, and half-open / half-shut was arbitrary. In the
// APP it is a requirement. The in-app Help dialog draws its contents rail by
// reading this sidebar out of a built page (web/src/services/helpDocs.ts), and
// Docusaurus renders a COLLAPSED category's children into no page at all, so a
// collapsed group here is a group missing from the rail. e2e/help-dialog.spec.ts
// reaches into the last category for exactly that reason.
const sidebars: SidebarsConfig = {
  docs: [
    { type: 'category', label: 'Introduction', collapsed: false, items: ['overview', 'features', 'technical-documentation', 'faq'] },
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['getting-started', 'settings', 'offline-and-installing'],
    },
    {
      type: 'category',
      label: 'User Guide',
      collapsed: false,
      items: ['designing-a-rocket', 'motors', 'views-and-analysis', 'running-a-simulation', 'files-and-exports', 'safety'],
    },
    {
      type: 'category',
      label: 'Developing',
      collapsed: false,
      items: ['contributing', 'developer-guide', 'architecture', 'dependencies'],
    },
  ],
};

export default sidebars;
