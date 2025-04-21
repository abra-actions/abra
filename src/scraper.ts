export interface ScrapedContent {
    pageTitle: string;
    routes: string[];
    navLabels: string[];
    sections: { heading: string; content: string }[];
  }
  
  const isElementVisible = (el: HTMLElement): boolean => {
    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      !el.hasAttribute('aria-hidden')
    );
  };
  
  export const scrapeDOM = (): ScrapedContent => {
    const pageTitle = document.title;
  
    const navLabels = Array.from(document.querySelectorAll('nav a'))
      .filter(el => isElementVisible(el as HTMLElement))
      .map(el => (el as HTMLElement).innerText.trim())
      .filter(text => text.length > 0);
  
    const routes = Array.from(document.querySelectorAll('a[href^="/"]'))
      .filter(el => isElementVisible(el as HTMLElement))
      .map(el => (el as HTMLAnchorElement).href);
  
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
      .filter(el => isElementVisible(el as HTMLElement));
  
    const sections = headings.map(heading => {
      let content = '';
      let nextEl = heading.nextElementSibling;
  
      while (nextEl && !/^H[1-4]$/.test(nextEl.tagName)) {
        if (isElementVisible(nextEl as HTMLElement) && !['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(nextEl.tagName)) {
          content += ` ${nextEl.textContent?.trim()}`;
        }
        nextEl = nextEl.nextElementSibling;
      }
  
      return {
        heading: heading.textContent?.trim() || '',
        content: content.trim(),
      };
    }).filter(section => section.content.length > 0);
  
    return {
      pageTitle,
      routes: Array.from(new Set(routes)),
      navLabels: Array.from(new Set(navLabels)),
      sections,
    };
  };
  