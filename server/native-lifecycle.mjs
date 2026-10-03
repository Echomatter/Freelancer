/** Keep the owner process alive until an independently observed child close. */
export async function retainOwnershipUntilClosed(error, whenClosed, { report = console.error } = {}) {
  if (!whenClosed || typeof whenClosed.then !== 'function') throw error;
  // A pending promise does not keep Node alive. Retain the owner PID and its
  // instance lock even after the native process releases its stdio handles.
  const ownership = setInterval(() => {}, 1000);
  try {
    try { report('Native shutdown is unconfirmed; retaining Freelancer ownership until its process closes.', error); }
    catch { /* Reporting cannot release ownership of an unconfirmed process. */ }
    await whenClosed;
  } finally { clearInterval(ownership); }
}
