import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// Mirrors the old wiki Home.md index, which had to be maintained by hand.
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
      items: ['designing-a-rocket', 'motors', 'views-and-analysis', 'running-a-simulation', 'files-and-exports'],
    },
    {
      type: 'category',
      label: 'Developing',
      items: ['contributing', 'developer-guide', 'architecture', 'dependencies'],
    },
  ],
};

export default sidebars;
