// Interface text in English and Turkish. Every visible string lives here.

const en = {
  appName: 'filextext',
  loading: 'Opening…',
  notInFilex: 'This page runs inside filex. Open a .fxtxt file there.',
  notFxtxt: 'This file is not a filextext workspace.',
  damaged: 'The workspace is damaged and cannot be opened.',
  unsupported: 'This workspace was saved by a newer filextext. Ask your administrator to update the app.',
  readError: 'The file could not be read: {msg}',
  readOnlyNew: 'This file is read-only here, so a workspace cannot be created in it.',
  e2eBadge: 'End-to-end encrypted',

  createTitle: 'Create an encrypted workspace',
  createLead: 'Everything in {name} is encrypted in your browser. Choose a password; you will also get a recovery key.',
  createWarn:
    'filex never sees the password or the contents. If you lose both the password and the recovery key, nobody can open this workspace - not filex, not an administrator.',
  password: 'Password',
  password2: 'Password again',
  pwTooShort: 'At least {n} characters.',
  pwMismatch: 'The passwords do not match.',
  create: 'Create',
  deriving: 'Deriving the key…',

  rkTitle: 'Your recovery key',
  rkNewTitle: 'Your new recovery key',
  rkLead: 'This key opens the workspace without the password. It is shown only now: neither filex nor this app keeps it.',
  rkStore: 'Write it down or keep it in a password manager - somewhere other than the password.',
  select: 'Select',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Your browser did not allow copying here: select the text and press Ctrl+C.',
  rkAck: 'I have saved the recovery key',
  continue: 'Continue',

  unlockTitle: '{name} is encrypted',
  unlockLead: 'Enter the password to open it.',
  open: 'Open',
  wrongPassword: 'Wrong password.',
  useKey: 'Lost the password? Use the recovery key',
  keyTitle: 'Open with the recovery key',
  keyLead: 'Type the 32-character key. You will then set a new password.',
  recoveryKey: 'Recovery key',
  wrongKey: 'That recovery key does not open this workspace.',
  usePassword: 'Use the password instead',

  resetTitle: 'Set a new password',
  resetLead:
    'You opened the workspace with the recovery key, so it gets a new password and a new recovery key. Neither the old password nor the old recovery key will open it any more.',
  resetReadOnly: 'This file is read-only here, so its password cannot be reset now. The workspace opens read-only.',
  newPassword: 'New password',
  newPassword2: 'New password again',
  saveNewPassword: 'Save the new password',

  pages: 'Pages',
  newPage: 'New page',
  newFolder: 'New folder',
  newPageHere: 'New page here',
  newFolderHere: 'New folder here',
  untitled: 'Untitled',
  importFiles: 'Import .md / .txt',
  rename: 'Rename',
  moveTo: 'Move to…',
  delete: 'Delete',
  topLevel: 'Top level',
  folderName: 'Folder name',
  pageTitle: 'Page title',
  deletePage: 'Delete the page “{name}”?',
  deleteFolder: 'Delete the folder “{name}” and everything in it ({n} pages)?',
  cantMoveHere: 'A folder cannot go inside itself.',
  cancel: 'Cancel',
  ok: 'OK',
  save: 'Save',
  close: 'Close',
  closeTab: 'Close tab',
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  allSaved: 'All changes saved',
  saveFailed: 'Could not save: {msg}',
  readOnly: 'Read-only: changes here cannot be saved.',
  tooLarge: 'The workspace is too large to save (over 200 MB).',
  menu: 'More',
  exportMd: 'Export page as Markdown…',
  exportTxt: 'Export page as text…',
  download: 'Download',
  downloaded: 'Downloaded',
  exportTitle: 'Export “{name}”',
  exportLead: 'This is the page in the clear: once you copy or download it, it is outside the encryption.',
  changePassword: 'Change password',
  changeLead: 'Confirm with the current password or with the recovery key, then choose the new password.',
  currentPassword: 'Current password',
  changeDone: 'Password changed and the workspace re-keyed: neither the old password nor the old recovery key opens it any more.',
  changeNote: 'You will get a new recovery key, shown once. Versions of this file saved before the change still open with the old password and key.',
  lock: 'Lock',
  dropHint: 'Drop .md or .txt files here to import them',
  imported: 'Imported {n} page(s).',
  importFailed: 'Could not import {name}: {msg}',
  emptyEditor: 'Open a page from the list, or create one.',
  fileChanged: 'This file was changed elsewhere.',
  reload: 'Reload',
  notAPage: 'Only .md, .markdown and .txt files can be imported.',
} as const;

export type Key = keyof typeof en;
type Dict = Record<Key, string>;

const tr: Dict = {
  appName: 'filextext',
  loading: 'Açılıyor…',
  notInFilex: 'Bu sayfa filex içinde çalışır. Bir .fxtxt dosyasını filex’te açın.',
  notFxtxt: 'Bu dosya bir filextext çalışma alanı değil.',
  damaged: 'Çalışma alanı bozuk, açılamıyor.',
  unsupported: 'Bu çalışma alanı daha yeni bir filextext ile kaydedilmiş. Yöneticinizden uygulamayı güncellemesini isteyin.',
  readError: 'Dosya okunamadı: {msg}',
  readOnlyNew: 'Bu dosya burada salt okunur; bu yüzden içinde çalışma alanı oluşturulamaz.',
  e2eBadge: 'Uçtan uca şifreli',

  createTitle: 'Şifreli çalışma alanı oluştur',
  createLead: '{name} içindeki her şey tarayıcınızda şifrelenir. Bir parola belirleyin; ayrıca bir kurtarma anahtarı alacaksınız.',
  createWarn:
    'filex ne parolayı ne de içeriği görür. Parolayı ve kurtarma anahtarını birlikte kaybederseniz bu çalışma alanını kimse açamaz - ne filex ne de bir yönetici.',
  password: 'Parola',
  password2: 'Parola (tekrar)',
  pwTooShort: 'En az {n} karakter.',
  pwMismatch: 'Parolalar eşleşmiyor.',
  create: 'Oluştur',
  deriving: 'Anahtar türetiliyor…',

  rkTitle: 'Kurtarma anahtarınız',
  rkNewTitle: 'Yeni kurtarma anahtarınız',
  rkLead: 'Bu anahtar çalışma alanını parolasız açar. Yalnız şimdi gösteriliyor: ne filex ne de bu uygulama onu saklar.',
  rkStore: 'Bir yere yazın ya da bir parola yöneticisinde saklayın - parolanın durduğu yerden başka bir yerde.',
  select: 'Seç',
  copy: 'Kopyala',
  copied: 'Kopyalandı',
  copyFailed: 'Tarayıcınız burada kopyalamaya izin vermedi: metni seçip Ctrl+C’ye basın.',
  rkAck: 'Kurtarma anahtarını kaydettim',
  continue: 'Devam',

  unlockTitle: '{name} şifreli',
  unlockLead: 'Açmak için parolayı girin.',
  open: 'Aç',
  wrongPassword: 'Parola yanlış.',
  useKey: 'Parolayı mı unuttunuz? Kurtarma anahtarını kullanın',
  keyTitle: 'Kurtarma anahtarıyla aç',
  keyLead: '32 karakterlik anahtarı yazın. Ardından yeni bir parola belirleyeceksiniz.',
  recoveryKey: 'Kurtarma anahtarı',
  wrongKey: 'Bu kurtarma anahtarı bu çalışma alanını açmıyor.',
  usePassword: 'Parolayla aç',

  resetTitle: 'Yeni parola belirleyin',
  resetLead:
    'Çalışma alanını kurtarma anahtarıyla açtınız; bu yüzden yeni bir parola ve yeni bir kurtarma anahtarı alacak. Eski parola da eski kurtarma anahtarı da artık açmayacak.',
  resetReadOnly: 'Bu dosya burada salt okunur; bu yüzden parolası şimdi sıfırlanamaz. Çalışma alanı salt okunur açılıyor.',
  newPassword: 'Yeni parola',
  newPassword2: 'Yeni parola (tekrar)',
  saveNewPassword: 'Yeni parolayı kaydet',

  pages: 'Sayfalar',
  newPage: 'Yeni sayfa',
  newFolder: 'Yeni klasör',
  newPageHere: 'Buraya yeni sayfa',
  newFolderHere: 'Buraya yeni klasör',
  untitled: 'Başlıksız',
  importFiles: '.md / .txt içe aktar',
  rename: 'Yeniden adlandır',
  moveTo: 'Taşı…',
  delete: 'Sil',
  topLevel: 'En üst düzey',
  folderName: 'Klasör adı',
  pageTitle: 'Sayfa başlığı',
  deletePage: '“{name}” sayfası silinsin mi?',
  deleteFolder: '“{name}” klasörü ve içindeki her şey ({n} sayfa) silinsin mi?',
  cantMoveHere: 'Bir klasör kendi içine taşınamaz.',
  cancel: 'Vazgeç',
  ok: 'Tamam',
  save: 'Kaydet',
  close: 'Kapat',
  closeTab: 'Sekmeyi kapat',
  saved: 'Kaydedildi',
  saving: 'Kaydediliyor…',
  unsaved: 'Kaydedilmemiş değişiklikler',
  allSaved: 'Tüm değişiklikler kaydedildi',
  saveFailed: 'Kaydedilemedi: {msg}',
  readOnly: 'Salt okunur: buradaki değişiklikler kaydedilemez.',
  tooLarge: 'Çalışma alanı kaydedilemeyecek kadar büyük (200 MB üzeri).',
  menu: 'Diğer',
  exportMd: 'Sayfayı Markdown olarak dışa aktar…',
  exportTxt: 'Sayfayı düz metin olarak dışa aktar…',
  download: 'İndir',
  downloaded: 'İndirildi',
  exportTitle: '“{name}” dışa aktar',
  exportLead: 'Bu, sayfanın şifresiz hâlidir: kopyaladığınız ya da indirdiğiniz anda şifrelemenin dışına çıkar.',
  changePassword: 'Parolayı değiştir',
  changeLead: 'Mevcut parolayla ya da kurtarma anahtarıyla doğrulayın, sonra yeni parolayı seçin.',
  currentPassword: 'Mevcut parola',
  changeDone: 'Parola değiştirildi ve çalışma alanı yeni bir anahtarla şifrelendi: eski parola da eski kurtarma anahtarı da artık açmıyor.',
  changeNote: 'Bir kez gösterilecek yeni bir kurtarma anahtarı alacaksınız. Bu dosyanın değişiklikten önce kaydedilmiş sürümleri eski parola ve anahtarla açılmaya devam eder.',
  lock: 'Kilitle',
  dropHint: 'İçe aktarmak için .md ya da .txt dosyalarını buraya bırakın',
  imported: '{n} sayfa içe aktarıldı.',
  importFailed: '{name} içe aktarılamadı: {msg}',
  emptyEditor: 'Listeden bir sayfa açın ya da yeni bir sayfa oluşturun.',
  fileChanged: 'Bu dosya başka bir yerde değiştirildi.',
  reload: 'Yeniden yükle',
  notAPage: 'Yalnız .md, .markdown ve .txt dosyaları içe aktarılabilir.',
};

const dicts: Record<string, Dict> = { en, tr };

let current: Dict = en;
let currentLang = 'en';

/** Pick the language from a tag like `tr`, `tr-TR`, `en-GB`. */
export function setLocale(tag: string | undefined): string {
  const base = (tag || 'en').toLowerCase().split(/[-_]/)[0];
  currentLang = dicts[base] ? base : 'en';
  current = dicts[currentLang];
  document.documentElement.lang = currentLang;
  return currentLang;
}

export function lang(): string {
  return currentLang;
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return (current[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** For tests: both dictionaries have the same keys. */
export const dictionaries = { en: en as Dict, tr };
