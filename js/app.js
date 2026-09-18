// Interaction is intentionally minimal.
// This first commit establishes the foundation; product flows come next.

const beginButton = document.querySelector(".begin-button");

beginButton?.addEventListener("click", () => {
  beginButton.textContent = "Coming next: choose a paper";
});