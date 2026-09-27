// Every string exists in both languages, and the Turkish is written with
// Turkish letters (ı İ ş Ş ğ Ğ ü Ü ö Ö ç Ç), never ASCII look-alikes.
import { describe, expect, it } from 'vitest';

import { dictionaries } from '../src/i18n';

describe('interface text', () => {
  it('has the same keys in English and Turkish, none empty', () => {
    expect(Object.keys(dictionaries.tr).sort()).toEqual(Object.keys(dictionaries.en).sort());
    for (const [k, v] of Object.entries(dictionaries.tr)) expect(v.trim(), k).not.toBe('');
  });

  it('keeps the same {placeholders} in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(dictionaries.en) as (keyof typeof dictionaries.en)[]) {
      expect(vars(dictionaries.tr[k]), k).toEqual(vars(dictionaries.en[k]));
    }
  });

  it('writes Turkish with Turkish letters', () => {
    const tr = dictionaries.tr;
    expect(tr.createTitle).toBe('Şifreli çalışma alanı oluştur');
    expect(tr.untitled).toBe('Başlıksız');
    expect(tr.moveTo).toBe('Taşı…');
    expect(tr.changePassword).toBe('Parolayı değiştir');
    const all = Object.values(tr).join('\n');
    const asciiFied = /\b(Sifre\w*|sifre\w*|calisma|olustur\w*|Baslik\w*|Tasi|Parolayi|degistir\w*|icin|kaydedilmemis|anahtari|guncelle\w*|yonetici\w*|Gizli iceri\w*)\b/;
    expect(all).not.toMatch(asciiFied);
  });
});
