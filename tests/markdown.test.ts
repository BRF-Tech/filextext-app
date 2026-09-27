// Importing a Markdown file: a leading `# Heading` becomes the page title
// (and leaves the body), so export → import → export gives the same text.
// Otherwise the file name is the title.
import { describe, expect, it } from 'vitest';

import { splitTitle } from '../src/model/markdown';

describe('splitTitle', () => {
  it('takes a leading level-1 heading as the title', () => {
    expect(splitTitle('# Haftalık plan\n\n- a\n- b\n', 'Plan')).toEqual({ title: 'Haftalık plan', body: '- a\n- b\n' });
  });

  it('skips blank lines and front matter before the heading', () => {
    expect(splitTitle('\n\n#   Başlık   \nmetin', 'x')).toEqual({ title: 'Başlık', body: 'metin' });
    expect(splitTitle('---\ntags: [a]\n---\n# Başlık\nmetin', 'x')).toEqual({ title: 'Başlık', body: '---\ntags: [a]\n---\nmetin' });
  });

  it('strips a closing run of #s', () => {
    expect(splitTitle('# Başlık ##\nmetin', 'x').title).toBe('Başlık');
  });

  it('falls back to the file name when there is no leading level-1 heading', () => {
    expect(splitTitle('## İkinci düzey\nmetin', 'Dosya')).toEqual({ title: 'Dosya', body: '## İkinci düzey\nmetin' });
    expect(splitTitle('metin\n# Sonra', 'Dosya')).toEqual({ title: 'Dosya', body: 'metin\n# Sonra' });
    expect(splitTitle('#etiket değil başlık', 'Dosya').title).toBe('Dosya');
    expect(splitTitle('', 'Boş')).toEqual({ title: 'Boş', body: '' });
  });

  it('does not take a heading inside a code fence', () => {
    expect(splitTitle('```\n# not a title\n```', 'Kod').title).toBe('Kod');
  });
});
