const confirmButton = document.getElementById('confirm-button');

confirmButton.addEventListener('click', () => {
  // Hit confirm POST and make button loading
  confirmButton.classList.add('loading');
  confirmButton.disabled = true;
  fetch('/confirm', {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then((resp) => resp.json())
    .then((resp) => {
      const matched = resp.matched;
      confirmButton.classList.remove('loading');
      confirmButton.textContent = `DELETION BEGUN - ${matched} TWEETS ARE BEING ERASED`;
    });
});
