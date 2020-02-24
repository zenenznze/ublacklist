// #if BROWSER === 'firefox'
import dialogPolyfill from 'dialog-polyfill';
// #endif
import { apis } from './apis';
import { Blacklist } from './blacklist';
import { BlockForm } from './block-form';
import './content-handlers';
import * as LocalStorage from './local-storage';
import { sendMessage } from './messages';
import { Subscriptions } from './types';
import { AltURL } from './utilities';

let blacklist: Blacklist | null = null;
let blockForm: BlockForm | null = null;
let blockedEntryCount = 0;
const queuedEntries: HTMLElement[] = [];
const queuedStyles: string[] = [];

function $(id: 'ub-hide-style'): HTMLStyleElement | null;
function $(id: 'ub-block-dialog'): HTMLDialogElement | null;
function $(id: string): HTMLElement | null;
function $(id: string): HTMLElement | null {
  return document.getElementById(id) as HTMLElement | null;
}

function judgeEntry(entry: HTMLElement): void {
  if (blacklist!.test(new AltURL(entry.dataset.ubUrl!))) {
    entry.classList.add('ub-is-blocked');
    ++blockedEntryCount;
  }
}

function updateControl(): void {
  const $control = $('ub-control');
  if (!$control) {
    return;
  }
  if (blockedEntryCount) {
    $control.classList.remove('ub-is-hidden');
    $control.querySelector('.ub-stats')!.textContent =
      blockedEntryCount === 1
        ? apis.i18n.getMessage('content_singleSiteBlocked')
        : apis.i18n.getMessage('content_multipleSitesBlocked', String(blockedEntryCount));
  } else {
    $control.classList.add('ub-is-hidden');
  }
}

function onItemsLoaded(b: string, subscriptions: Subscriptions, hideBlockLinks: boolean): void {
  blacklist = new Blacklist(
    b,
    Object.values(subscriptions).map(subscription => subscription.blacklist),
  );
  for (const entry of queuedEntries) {
    judgeEntry(entry);
  }
  updateControl();
  queuedEntries.length = 0;
  if (hideBlockLinks) {
    const style = `
      <style>
        .ub-action {
          display: none !important;
        }
      </style>
    `;
    if (document.head) {
      document.head.insertAdjacentHTML('beforeend', style);
    } else {
      queuedStyles.push(style);
    }
  }
}

function onElementAdded(addedElement: HTMLElement): void {
  for (const entryHandler of window.ubContentHandlers!.entryHandlers) {
    const entries = entryHandler.getEntries(addedElement).filter(entry => {
      if (entry.hasAttribute('data-ub-url')) {
        return false;
      }
      const url = entryHandler.getURL(entry);
      if (url == null) {
        return false;
      }
      const action = entryHandler.createAction(entry);
      if (!action) {
        return false;
      }
      entry.setAttribute('data-ub-url', url);
      action.classList.add('ub-action');
      action.innerHTML = `
        <span class="ub-block-button">
          ${apis.i18n.getMessage('content_blockSiteLink')}
        </span>
        <span class="ub-unblock-button">
          ${apis.i18n.getMessage('content_unblockSiteLink')}
        </span>
      `;
      const onBlockButtonClicked = (e: Event): void => {
        e.preventDefault();
        e.stopPropagation();
        blockForm!.initialize(blacklist!, new AltURL(url), () => {
          sendMessage('set-blacklist', blacklist!.toString());
          blockedEntryCount = 0;
          for (const entry of document.querySelectorAll<HTMLElement>('[data-ub-url]')) {
            entry.classList.remove('ub-is-blocked');
            judgeEntry(entry);
          }
          updateControl();
          if (!blockedEntryCount) {
            $('ub-hide-style')!.sheet!.disabled = false;
          }
        });
        $('ub-block-dialog')!.showModal();
      };
      action.querySelector('.ub-block-button')!.addEventListener('click', onBlockButtonClicked);
      action.querySelector('.ub-unblock-button')!.addEventListener('click', onBlockButtonClicked);
      if (entryHandler.adjustEntry) {
        entryHandler.adjustEntry(entry);
      }
      if (blacklist) {
        judgeEntry(entry);
        updateControl();
      } else {
        queuedEntries.push(entry);
      }
      return true;
    });
    if (entries.length) {
      return;
    }
  }
  if (window.ubContentHandlers!.pageHandlers) {
    for (const pageHandler of window.ubContentHandlers!.pageHandlers) {
      const addedElements = pageHandler.getAddedElements(addedElement);
      addedElements.map(onElementAdded);
      if (addedElements.length) {
        return;
      }
    }
  }
}

function onDOMContentLoaded(): void {
  for (const controlHandler of window.ubContentHandlers!.controlHandlers) {
    const $control = controlHandler.createControl();
    if (!$control) {
      continue;
    }
    $control.id = 'ub-control';
    $control.innerHTML = `
      <span class="ub-stats"></span>
      <span class="ub-show-button">
        ${apis.i18n.getMessage('content_showBlockedSitesLink')}
      </span>
      <span class="ub-hide-button">
        ${apis.i18n.getMessage('content_hideBlockedSitesLink')}
      </span>
    `;
    $control.querySelector('.ub-show-button')!.addEventListener('click', () => {
      $('ub-hide-style')!.sheet!.disabled = true;
    });
    $control.querySelector('.ub-hide-button')!.addEventListener('click', () => {
      $('ub-hide-style')!.sheet!.disabled = false;
    });
    updateControl();
    break;
  }
  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <dialog id="ub-block-dialog" class="ub-block-dialog">
        <div id="ub-block-form"></div>
      </dialog>
    `,
  );
  const $blockDialog = $('ub-block-dialog')!;
  // #if BROWSER === 'firefox'
  dialogPolyfill.registerDialog($blockDialog);
  // #endif
  $blockDialog.addEventListener('click', e => {
    if (e.target === $blockDialog) {
      $blockDialog.close();
    }
  });
  blockForm = new BlockForm($('ub-block-form')!, () => {
    $blockDialog.close();
  });
}

function main(): void {
  if (!window.ubContentHandlers) {
    return;
  }
  (async () => {
    const { blacklist: b, subscriptions, hideBlockLinks } = await LocalStorage.load(
      'blacklist',
      'subscriptions',
      'hideBlockLinks',
    );
    onItemsLoaded(b, subscriptions, hideBlockLinks);
  })();
  const hideStyle = `
    <style id="ub-hide-style">
      .ub-show-button {
        display: inline !important;
      }
      .ub-hide-button {
        display: none;
      }
      .ub-is-blocked {
        display: none !important;
      }
    </style>
  `;
  if (document.head) {
    document.head.insertAdjacentHTML('beforeend', hideStyle);
  } else {
    queuedStyles.push(hideStyle);
  }
  new MutationObserver(records => {
    if (document.head) {
      for (const style of queuedStyles) {
        document.head.insertAdjacentHTML('beforeend', style);
      }
      queuedStyles.length = 0;
    }
    for (const record of records) {
      for (const addedNode of record.addedNodes) {
        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          onElementAdded(addedNode as HTMLElement);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
}

main();