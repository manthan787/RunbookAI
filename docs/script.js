function copyCode(btn, codeId) {
  const code = document.getElementById(codeId).textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    btn.style.background = 'rgba(34, 197, 94, 0.2)';
    btn.style.borderColor = 'rgba(34, 197, 94, 0.5)';
    btn.style.color = '#22c55e';
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 2000);
  });
}
