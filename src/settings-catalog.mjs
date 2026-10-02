// Presentation metadata only. This catalog never grants runtime access.
// Keep route IDs stable: App.tsx owns navigation and the existing save handlers.
export const settingsGroups = {
  project: [{ items: ['sessions', 'delegation', 'goals', 'files', 'search', 'github'] }],
  application: [{ items: ['appearance', 'agents', 'providers', 'models', 'usage', 'capabilities', 'schedules', 'history', 'search', 'content-storage', 'file-access', 'git-defaults', 'remote-access'] }],
};

export const settingsPages = [
  { scope: 'project', id: 'files', title: 'Files', icon: 'files', layout: 'wide', kind: 'Browse', description: 'Browse the selected project, inspect chat changes, and preview files. This page does not change file-access permissions.' },
  { scope: 'project', id: 'search', title: 'Search project content', icon: 'search', layout: 'wide', kind: 'Search', description: 'Search indexed files and conversations in the selected project. Index maintenance is in Content & Storage.' },
  { scope: 'application', id: 'agents', title: 'Agents', icon: 'agents', layout: 'wide', kind: 'Application settings', description: 'Agent definitions are shared across all projects. Choose an agent here; set this project’s starting agent in Session defaults.' },
  { scope: 'project', id: 'goals', title: 'Goals', icon: 'goals', layout: 'wide', kind: 'Project work', description: 'Manage objectives and their linked chats for the selected project. Saving a goal and starting its work are separate actions.' },
  { scope: 'project', id: 'sessions', title: 'Session defaults', icon: 'sessions', layout: 'form', kind: 'Project defaults', description: 'Choose how new chats start in this project. Context-window settings below have their own save action.' },
  { scope: 'project', id: 'delegation', title: 'Delegation', icon: 'delegation', layout: 'form', kind: 'Project or chat', description: 'Choose the scope before editing worker preferences and limits. These choices do not replace native permissions or your Git agreement.' },
  { scope: 'project', id: 'github', title: 'GitHub', icon: 'github', layout: 'wide', kind: 'Project repository', description: 'Manage local history, the GitHub destination, and this project’s working agreement. Review selected files before publishing.' },
  { scope: 'application', id: 'models', title: 'Models', icon: 'models', layout: 'wide', kind: 'Browse', description: 'Compare models, filter by provider and access type, and choose a model for the current chat.' },
  { scope: 'application', id: 'usage', title: 'Available Usage', icon: 'usage', layout: 'wide', kind: 'Activity and preferences', description: 'Review estimated availability and resets. Provider connections are managed separately in Providers.' },
  { scope: 'application', id: 'history', title: 'Conversation history', icon: 'history', layout: 'wide', kind: 'Browse and organize', description: 'Select a project to review, archive, restore, or export its conversations. Goal archives are managed in Goals.' },
  { scope: 'application', id: 'providers', title: 'Providers', icon: 'providers', layout: 'wide', kind: 'Application settings', description: 'Manage connections, optional billing information, and provider colors. Connection, billing, and color changes save independently.' },
  { scope: 'application', id: 'appearance', title: 'Appearance', icon: 'appearance', layout: 'wide', kind: 'Application settings', description: 'Choose a theme for the entire workspace, or create a custom palette. Theme choices save when selected.' },
  { scope: 'application', id: 'remote-access', title: 'Remote access', icon: 'remote-access', layout: 'form', kind: 'This computer', description: 'Configure access to this running Freelancer server, then pair browsers and manage remembered devices.' },
  { scope: 'application', id: 'schedules', title: 'Scheduled prompts', icon: 'schedules', layout: 'wide', kind: 'Across projects', description: 'Manage scheduled prompts across projects. Each schedule identifies its own project, agent, model, and first run time.' },
  { scope: 'application', id: 'search', title: 'Search all content', icon: 'search', layout: 'wide', kind: 'Search', description: 'Search indexed files and conversations across registered projects. Results identify their project and source.' },
  { scope: 'application', id: 'content-storage', title: 'Content & Storage', icon: 'content-storage', layout: 'wide', kind: 'Application settings', description: 'Manage project indexes, local data locations, and database maintenance. Project files and OpenCode data retain their existing ownership.' },
  { scope: 'application', id: 'file-access', title: 'File access', icon: 'files', layout: 'form', kind: 'Application settings', description: 'Choose which file locations agents can read, search and edit.' },
  { scope: 'application', id: 'git-defaults', title: 'Git defaults', icon: 'git-defaults', layout: 'form', kind: 'New projects', description: 'Choose the starting working style for new projects. Existing projects retain their saved working agreements.' },
  { scope: 'application', id: 'capabilities', title: 'Capabilities', icon: 'capabilities', layout: 'wide', kind: 'Runtime inventory', description: 'Inspect shared tools, skills, and connected services. Inventory is observed through the open project; registration is not proof of successful use.' },
];

export function settingsPage(scope, id) {
  return settingsPages.find(page => page.scope === scope && page.id === id);
}
export function settingsPageForTitle(title) {
  if (title === 'New agent' || title === 'Edit agent') return {
    ...settingsPage('application', 'agents'), layout: 'form',
    description: 'This definition is shared across projects. Save changes for future assignments; running work keeps its captured instructions.',
  };
  return settingsPages.find(page => page.title === title);
}
