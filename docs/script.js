// RunbookAI Documentation - Interactive Features

// Mobile menu toggle
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  menu.classList.toggle('active');
}

// Copy to clipboard functionality
function copyToClipboard(button) {
  const textToCopy = button.getAttribute('data-copy');

  navigator.clipboard.writeText(textToCopy).then(() => {
    // Add copied state
    button.classList.add('copied');

    // Store original icon
    const originalHTML = button.innerHTML;

    // Show checkmark
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `;

    // Reset after 2 seconds
    setTimeout(() => {
      button.classList.remove('copied');
      button.innerHTML = originalHTML;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// Smooth scroll for anchor links
document.addEventListener('DOMContentLoaded', () => {
  // Handle anchor links with smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });

        // Close mobile menu if open
        const menu = document.getElementById('mobile-menu');
        if (menu) {
          menu.classList.remove('active');
        }
      }
    });
  });

  // Add active state to sidebar links on scroll (for docs page)
  const sidebarLinks = document.querySelectorAll('.sidebar-nav a');
  if (sidebarLinks.length > 0) {
    const sections = [];

    sidebarLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const section = document.querySelector(href);
        if (section) {
          sections.push({ link, section, id: href });
        }
      }
    });

    function updateActiveLink() {
      const scrollPosition = window.scrollY + 120;

      let activeSection = null;

      sections.forEach(({ link, section, id }) => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;

        if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
          activeSection = link;
        }
      });

      sidebarLinks.forEach(link => link.classList.remove('active'));

      if (activeSection) {
        activeSection.classList.add('active');
      } else if (sections.length > 0 && window.scrollY < sections[0].section.offsetTop) {
        sections[0].link.classList.add('active');
      }
    }

    window.addEventListener('scroll', updateActiveLink);
    updateActiveLink();
  }

  // Intersection Observer for fade-in animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe elements with animate class
  document.querySelectorAll('.feature-card, .use-case-card, .workflow-step, .integration-category').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });

  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    .animate-in {
      opacity: 1 !important;
      transform: translateY(0) !important;
    }
  `;
  document.head.appendChild(style);

  // Close mobile menu when clicking outside
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobile-menu');
    const toggle = document.querySelector('.nav-mobile-toggle');

    if (menu && menu.classList.contains('active')) {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove('active');
      }
    }
  });

  // Keyboard accessibility for mobile menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = document.getElementById('mobile-menu');
      if (menu) {
        menu.classList.remove('active');
      }
    }
  });
});

// Syntax Highlighting
function highlightCode() {
  const configBlocks = document.querySelectorAll('.config-block');

  configBlocks.forEach(block => {
    const header = block.querySelector('.config-header');
    const codeEl = block.querySelector('pre code');
    if (!header || !codeEl) return;

    const headerText = header.textContent.toLowerCase();
    const code = codeEl.textContent;

    let highlighted;
    if (headerText.includes('terminal') || headerText.includes('.sh')) {
      highlighted = highlightBash(code);
    } else if (headerText.includes('.yaml') || headerText.includes('.yml') || headerText.includes('config')) {
      highlighted = highlightYaml(code);
    } else if (headerText.includes('.md')) {
      highlighted = highlightMarkdown(code);
    } else {
      highlighted = highlightBash(code); // Default to bash
    }

    codeEl.innerHTML = highlighted;
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightBash(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    // Escape HTML first
    let escaped = escapeHtml(line);

    // Comments (must be done first)
    if (escaped.trim().startsWith('#')) {
      return `<span class="token-comment">${escaped}</span>`;
    }

    // Process the line
    let result = escaped;

    // Strings (double and single quoted)
    result = result.replace(/"([^"\\]|\\.)*"/g, '<span class="token-string">$&</span>');
    result = result.replace(/'([^'\\]|\\.)*'/g, '<span class="token-string">$&</span>');

    // Environment variables $VAR and ${VAR}
    result = result.replace(/\$\{[^}]+\}/g, '<span class="token-env">$&</span>');
    result = result.replace(/\$[A-Z_][A-Z0-9_]*/g, '<span class="token-env">$&</span>');

    // Flags (--flag and -f)
    result = result.replace(/\s(--?[a-zA-Z][-a-zA-Z0-9]*)/g, ' <span class="token-flag">$1</span>');

    // Commands at the start of lines (common commands)
    const commands = ['git', 'bun', 'npm', 'runbook', 'cd', 'mkdir', 'cp', 'export', 'echo', 'curl', 'docker', 'kubectl', 'aws'];
    commands.forEach(cmd => {
      const regex = new RegExp(`^(${cmd})\\b`, 'g');
      result = result.replace(regex, '<span class="token-command">$1</span>');
    });

    // Subcommands after main commands
    result = result.replace(/(<span class="token-command">[^<]+<\/span>\s+)(run|dev|install|clone|status|add|commit|push|pull|ask|investigate|knowledge|slack-gateway)/g,
      '$1<span class="token-function">$2</span>');

    return result;
  }).join('\n');
}

function highlightYaml(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let escaped = escapeHtml(line);

    // Comments
    if (escaped.trim().startsWith('#')) {
      return `<span class="token-comment">${escaped}</span>`;
    }

    // Empty lines
    if (escaped.trim() === '') return escaped;

    let result = escaped;

    // Key: value pairs
    const keyMatch = result.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)(:)/);
    if (keyMatch) {
      const indent = keyMatch[1];
      const key = keyMatch[2];
      const colon = keyMatch[3];
      const rest = result.slice(keyMatch[0].length);

      // Process the value part
      let value = rest;

      // Strings in values
      value = value.replace(/"([^"\\]|\\.)*"/g, '<span class="token-string">$&</span>');
      value = value.replace(/'([^'\\]|\\.)*'/g, '<span class="token-string">$&</span>');

      // Environment variable references ${VAR}
      value = value.replace(/\$\{[^}]+\}/g, '<span class="token-env">$&</span>');

      // Booleans
      value = value.replace(/\b(true|false)\b/g, '<span class="token-keyword">$1</span>');

      // Numbers
      value = value.replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>');

      result = `${indent}<span class="token-yaml-key">${key}</span><span class="token-punctuation">${colon}</span>${value}`;
    }

    // Array items (- item)
    const arrayMatch = result.match(/^(\s*)(- )/);
    if (arrayMatch && !result.includes('token-yaml-key')) {
      const indent = arrayMatch[1];
      const dash = arrayMatch[2];
      let rest = result.slice(arrayMatch[0].length);

      // Strings in array items
      rest = rest.replace(/"([^"\\]|\\.)*"/g, '<span class="token-string">$&</span>');
      rest = rest.replace(/'([^'\\]|\\.)*'/g, '<span class="token-string">$&</span>');

      // Inline arrays [item1, item2]
      rest = rest.replace(/\[([^\]]+)\]/g, (match, content) => {
        const items = content.split(',').map(item => {
          const trimmed = item.trim();
          if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
            return `<span class="token-string">${item}</span>`;
          }
          return item;
        }).join(',');
        return `<span class="token-punctuation">[</span>${items}<span class="token-punctuation">]</span>`;
      });

      result = `${indent}<span class="token-list-marker">-</span> ${rest}`;
    }

    // Inline arrays at the end of lines
    result = result.replace(/: \[([^\]]+)\]$/g, (match, content) => {
      return `: <span class="token-punctuation">[</span>${content}<span class="token-punctuation">]</span>`;
    });

    return result;
  }).join('\n');
}

function highlightMarkdown(code) {
  const lines = code.split('\n');
  let inFrontmatter = false;
  let frontmatterDelimiterCount = 0;

  return lines.map(line => {
    let escaped = escapeHtml(line);

    // Frontmatter delimiters
    if (escaped.trim() === '---') {
      frontmatterDelimiterCount++;
      inFrontmatter = frontmatterDelimiterCount === 1;
      return `<span class="token-frontmatter">${escaped}</span>`;
    }

    // Inside frontmatter (YAML)
    if (inFrontmatter) {
      return highlightYaml(line);
    }

    // Headings
    if (escaped.match(/^#{1,6}\s/)) {
      return `<span class="token-heading">${escaped}</span>`;
    }

    // List items
    if (escaped.match(/^\s*[-*]\s/)) {
      const match = escaped.match(/^(\s*)([-*])(\s)/);
      if (match) {
        return `${match[1]}<span class="token-list-marker">${match[2]}</span>${match[3]}${escaped.slice(match[0].length)}`;
      }
    }

    // Numbered list items
    if (escaped.match(/^\s*\d+\.\s/)) {
      const match = escaped.match(/^(\s*)(\d+\.)(\s)/);
      if (match) {
        return `${match[1]}<span class="token-list-marker">${match[2]}</span>${match[3]}${escaped.slice(match[0].length)}`;
      }
    }

    // Inline code
    escaped = escaped.replace(/`([^`]+)`/g, '<span class="token-string">`$1`</span>');

    return escaped;
  }).join('\n');
}

// Initialize on page load
window.addEventListener('load', () => {
  highlightCode();
});
