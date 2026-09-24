// Increment when UI features require a different application response contract.
export const uiContract = 10;
export const compatibleApplication = (data) => data?.uiContract === uiContract;
