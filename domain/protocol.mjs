// Increment when UI features require a different application response contract.
export const uiContract = 11;
export const compatibleApplication = (data) => data?.uiContract === uiContract;
