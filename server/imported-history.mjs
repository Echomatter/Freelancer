// Read compatibility for snapshots saved before conversation import was retired.
// This adapter never scans another application's files or creates continuations.
export const importedChatID = id => /^ses_chatgpt_[a-f0-9]{32}$/.test(id ?? '');

export function createImportedHistory(localData) {
  return {
    list: project => localData.get().chatGPTChats(project),
    get: (project, id) => localData.get().chatGPTChat(project, id),
    source: (project, nativeID) => localData.get().chatGPTSource(project, nativeID),
  };
}
