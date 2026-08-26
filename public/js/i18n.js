'use strict';

const I18N = {
  current: localStorage.getItem('veyrona_language') || 'en',

  translations: {
    en: {
      language: 'Language',
      dashboard: 'Dashboard',
      procurementRequests: 'Procurement Requests',
      rfqsQuotations: 'RFQs & Quotations',
      customerQuotations: 'Customer Quotations',
      orders: 'Orders',
      customers: 'Customers',
      suppliers: 'Suppliers',
      auditLog: 'Audit Log',
      overview: 'Overview',
      pipeline: 'Pipeline',
      network: 'Network',
      governance: 'Governance',
      signOut: 'Sign out',
      signIn: 'Sign in',
      customer: 'Customer',
      supplier: 'Supplier',
      veyronaAdmin: 'Veyrona Admin',
      customerPortal: 'Customer Portal',
      supplierPortal: 'Supplier Portal',
      email: 'Email',
      password: 'Password',
      enterEmail: 'Enter your email',
      enterPassword: 'Enter your password',
      requestManage: 'Request & manage procurement',
      rfqShort: 'RFQs & quotations',
      managePlatform: 'Manage the platform'
    },

    fr: {
      language: 'Langue',
      dashboard: 'Tableau de bord',
      procurementRequests: 'Demandes d’achat',
      rfqsQuotations: 'Appels d’offres et devis',
      customerQuotations: 'Devis clients',
      orders: 'Commandes',
      customers: 'Clients',
      suppliers: 'Fournisseurs',
      auditLog: 'Journal d’audit',
      overview: 'Vue d’ensemble',
      pipeline: 'Processus',
      network: 'Réseau',
      governance: 'Gouvernance',
      signOut: 'Se déconnecter',
      signIn: 'Se connecter',
      customer: 'Client',
      supplier: 'Fournisseur',
      veyronaAdmin: 'Administrateur Veyrona',
      customerPortal: 'Portail client',
      supplierPortal: 'Portail fournisseur',
      email: 'E-mail',
      password: 'Mot de passe',
      enterEmail: 'Entrez votre e-mail',
      enterPassword: 'Entrez votre mot de passe',
      requestManage: 'Créer et gérer vos demandes d’achat',
      rfqShort: 'Appels d’offres et devis',
      managePlatform: 'Gérer la plateforme'
    }
  },

  t(key) {
    return this.translations[this.current]?.[key]
      || this.translations.en[key]
      || key;
  },

  setLanguage(language) {
    this.current = language;
    localStorage.setItem('veyrona_language', language);

    if (typeof render === 'function') {
      render();
    }
  }
};

function languageSwitcher() {
  return `
    <div class="language-switcher">
      <span>🌐</span>

      <select id="language-select">
        <option value="en"
          ${I18N.current === 'en' ? 'selected' : ''}>
          🇬🇧 English
        </option>

        <option value="fr"
          ${I18N.current === 'fr' ? 'selected' : ''}>
          🇫🇷 Français
        </option>
      </select>
    </div>
  `;
}

function initLanguageSwitcher() {
  const select = document.getElementById('language-select');

  if (!select) return;

  select.addEventListener('change', function () {
    I18N.setLanguage(this.value);
  });
}