// Lightweight i18n for CRYPTMessenger.
//
// The app ships French as the default locale (the UI strings were authored in
// French). This module adds a real translation layer + a runtime locale
// toggle so the UI can switch to English without a rebuild. Only the most
// visible strings are keyed so far; coverage is intentionally incremental —
// every `t(key)` falls back to the French dictionary, then to the raw key, so
// missing keys can never blank out the UI.
import { useStore } from './store'

export type Locale = 'fr' | 'en'

type Dict = Record<string, string>

const fr: Dict = {
  'nav.messages': 'Messages',
  'nav.contacts': 'Contacts',
  'nav.network': 'Réseau',
  'nav.settings': 'Réglages',

  'action.newChat': 'Nouvelle conversation',
  'action.newGroup': 'Nouveau groupe',
  'action.searchMessages': 'Rechercher',
  'action.markAllRead': 'Tout marquer comme lu',
  'action.send': 'Envoyer',
  'action.cancel': 'Annuler',
  'action.create': 'Créer',
  'action.share': 'Partager mon identité',
  'action.export': 'Exporter',
  'action.restore': 'Restaurer',
  'action.signout': 'Se déconnecter',
  'action.collapse': 'Réduire',
  'action.expand': 'Déployer',

  'composer.placeholder': 'Message chiffré E2E…',
  'composer.ephemeralOn': 'Message éphémère : disparaît après lecture',
  'composer.ephemeralOff': 'Rendre ce message éphémère (disparaît après lecture)',
  'composer.attach': 'Joindre un fichier',

  'header.search': 'Rechercher…',

  'settings.title': 'Réglages',
  'settings.identity': 'Mon identité',
  'settings.network': 'Réseau',
  'settings.encryption': 'Chiffrement',
  'settings.backup': 'Sauvegarde et restauration',
  'settings.language': 'Langue',
  'settings.lightTheme': 'Thème clair',
  'settings.autoNetwork': 'Basculement auto du réseau',
  'settings.offlineMode': 'Mode hors-ligne',
  'settings.e2ee': 'Chiffrement E2E',
  'settings.notifications': 'Notifications',
  'settings.typing': 'Indicateurs de saisie',
  'settings.tempDisplay': 'Affichage temporaire des messages',
  'settings.ephemeral': 'Messages éphémères',
  'settings.preferredNetwork': 'Réseau préféré',

  'group.newTitle': 'Nouveau groupe',
  'group.namePlaceholder': 'Nom du groupe',
  'group.selectOne': 'Sélectionnez au moins un contact.',
  'group.noContacts': 'Ajoutez d’abord des contacts.',
  'group.createFailed': 'Impossible de créer le groupe.',

  'common.pending': 'En attente',
  'common.add': 'Ajouter',
  'common.none': 'Aucune conversation',
  'common.start': 'Recherchez un utilisateur pour commencer',
  'common.noUserFound': 'Aucun utilisateur trouvé',
  'common.noMsgFound': 'Aucun message trouvé',
  'common.reconnecting': 'Reconnexion… vos messages seront envoyés automatiquement.',
  'chat.messages': 'Historique des messages',
}

const en: Dict = {
  'nav.messages': 'Chats',
  'nav.contacts': 'Contacts',
  'nav.network': 'Network',
  'nav.settings': 'Settings',

  'action.newChat': 'New chat',
  'action.newGroup': 'New group',
  'action.searchMessages': 'Search',
  'action.markAllRead': 'Mark all as read',
  'action.send': 'Send',
  'action.cancel': 'Cancel',
  'action.create': 'Create',
  'action.share': 'Share my identity',
  'action.export': 'Export',
  'action.restore': 'Restore',
  'action.signout': 'Sign out',
  'action.collapse': 'Collapse',
  'action.expand': 'Expand',

  'composer.placeholder': 'E2E encrypted message…',
  'composer.ephemeralOn': 'Disappearing message: vanishes after reading',
  'composer.ephemeralOff': 'Make this message disappear after reading',
  'composer.attach': 'Attach a file',

  'header.search': 'Search…',

  'settings.title': 'Settings',
  'settings.identity': 'My identity',
  'settings.network': 'Network',
  'settings.encryption': 'Encryption',
  'settings.backup': 'Backup & restore',
  'settings.language': 'Language',
  'settings.lightTheme': 'Light theme',
  'settings.autoNetwork': 'Auto network switch',
  'settings.offlineMode': 'Offline mode',
  'settings.e2ee': 'E2E encryption',
  'settings.notifications': 'Notifications',
  'settings.typing': 'Typing indicators',
  'settings.tempDisplay': 'Temporary message display',
  'settings.ephemeral': 'Disappearing messages',
  'settings.preferredNetwork': 'Preferred network',

  'group.newTitle': 'New group',
  'group.namePlaceholder': 'Group name',
  'group.selectOne': 'Select at least one contact.',
  'group.noContacts': 'Add contacts first.',
  'group.createFailed': 'Could not create the group.',

  'common.pending': 'Pending',
  'common.add': 'Add',
  'common.none': 'No conversations',
  'common.start': 'Search for a user to get started',
  'common.noUserFound': 'No user found',
  'common.noMsgFound': 'No message found',
  'common.reconnecting': 'Reconnecting… your messages will be sent automatically.',
  'chat.messages': 'Message history',
}

const dicts: Record<Locale, Dict> = { fr, en }

export function getLocale(): Locale {
  const loc = (useStore.getState().settings as any).locale as Locale | undefined
  return loc === 'en' ? 'en' : 'fr'
}

export function translate(key: string): string {
  const loc = getLocale()
  return dicts[loc][key] ?? dicts.fr[key] ?? key
}

// Subscribe to the locale so any component calling `useT()` re-renders when the
// user flips the language. The returned `t` always reads the current locale.
export function useT() {
  const locale = useStore((s) => (s.settings as any).locale as Locale)
  return (key: string) => translate(key)
}

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
]
