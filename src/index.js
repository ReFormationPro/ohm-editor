/* eslint-env browser */
/* global CodeMirror, ohm */

'use strict';

const domUtil = require('./domUtil');
const ohmEditor = require('./ohmEditor');

require('./editorErrors');
require('./examples');
require('./externalRules');
require('./parseTree');
require('./ruleHyperlinks');
require('./searchBar');
require('./splitters');
require('./persistence');

let grammarChanged = true;
let inputChanged = true;

let showFailuresImplicitly = true;

const $ = domUtil.$;
const $$ = domUtil.$$;

let grammarMatcher = ohm.ohmGrammar.matcher();

// Helpers
// -------

/* Available Grammar Selection */

function updateAvailableGrammars(parsedGrammars) {
  const availableGrammars = document.querySelector('#availableGrammars');

  const idx = availableGrammars.options.selectedIndex;
  let currentKey;
  if (idx !== -1) {
    currentKey = availableGrammars.options[availableGrammars.options.selectedIndex].value;
  }

  availableGrammars.required = true;
  availableGrammars.options.length = 0;

  const keys = Object.keys(parsedGrammars);
  let newIdx = -1;
  for (let i = 0; i < keys.length; i++) {
    const option = document.createElement('option');
    option.text = option.value = keys[i];
    availableGrammars.appendChild(option);
    if (option.value === currentKey) {
      newIdx = i;
    }
  }
  if (newIdx !== -1) {
    availableGrammars.options.selectedIndex = newIdx;
  }
}

const availableGrammars = document.querySelector('#availableGrammars');
availableGrammars.addEventListener('change', function(e) {
  grammarChanged = true;
  refresh();
});

function parseGrammar() {
  const matchResult = grammarMatcher.match();

  let grammar;
  let err;

  if (matchResult.succeeded()) {
    const ns = {};
    try {
      ohm._buildGrammar(matchResult, ns);
      // Update available grammars
      updateAvailableGrammars(ns);
      const availableGrammars = document.querySelector('#availableGrammars');
      const idx = availableGrammars.options.selectedIndex;
      let tmpGrammar;
      if (idx !== -1) {
        const currentKey = availableGrammars.options[availableGrammars.options.selectedIndex].value;
        tmpGrammar = ns[currentKey];
        if (tmpGrammar) {
          grammar = tmpGrammar;
        }
      }
      // If grammar is still not set and we have at least one grammar
      if (!grammar) {
        tmpGrammar = ns[Object.keys(ns)[0]];
        if (tmpGrammar) {
          grammar = tmpGrammar;
        } else {
          console.error('Error: No grammar found');
        }
      }
    } catch (ex) {
      err = ex;
    }
  } else {
    err = {
      message: matchResult.message,
      shortMessage: matchResult.shortMessage,
      interval: matchResult.getInterval(),
    };
  }
  return {
    matchResult,
    grammar,
    error: err,
  };
}

// Return the name of a valid start rule for grammar, or null if `optRuleName` is
// not valid and the grammar has no default starting rule.
function getValidStartRule(grammar, optRuleName) {
  if (optRuleName && optRuleName in grammar.rules) {
    return optRuleName;
  }
  if (grammar.defaultStartRule) {
    return grammar.defaultStartRule;
  }
  return null;
}

function refresh() {
  const grammarEditor = ohmEditor.ui.grammarEditor;
  const inputEditor = ohmEditor.ui.inputEditor;

  const grammarSource = grammarEditor.getValue();
  const inputSource = inputEditor.getValue();

  ohmEditor.saveState(inputEditor, 'input');

  // Refresh the option values.
  for (let i = 0; i < checkboxes.length; ++i) {
    const checkbox = checkboxes[i];
    ohmEditor.options[checkbox.name] = checkbox.checked;
  }

  if (inputChanged || grammarChanged) {
    showFailuresImplicitly = true; // Reset to default.
  }

  if (inputChanged) {
    inputChanged = false;
    ohmEditor.emit('change:input', inputSource);
  }

  if (grammarChanged) {
    grammarChanged = false;
    ohmEditor.emit('change:grammar', grammarSource);

    const result = parseGrammar();
    ohmEditor.grammar = result.grammar;
    ohmEditor.emit(
      'parse:grammar',
      result.matchResult,
      result.grammar,
      result.error
    );
  }

  if (ohmEditor.grammar) {
    const startRule = getValidStartRule(ohmEditor.grammar, ohmEditor.startRule);
    if (startRule) {
      const trace = ohmEditor.grammar.trace(inputSource, startRule);

      // When the input fails to parse, turn on "show failures" automatically.
      if (showFailuresImplicitly) {
        const checked = ($('input[name=showFailures]').checked =
          trace.result.failed());
        ohmEditor.options.showFailures = checked;
      }

      ohmEditor.emit('parse:input', trace.result, trace);
    }
  }
}

ohmEditor.setGrammar = function (grammar) {
  if (grammar === null) {
    // load from local storage or default element
    grammar = localStorage.getItem('grammar');
    if (!grammar || grammar === '') {
      grammar = $('#sampleGrammar').textContent; // default element
    }
  }
  const doc = CodeMirror.Doc(grammar, 'null');
  ohmEditor.ui.grammarEditor.swapDoc(doc);
};

ohmEditor.saveState = function (editor, key) {
  localStorage.setItem(key, editor.getValue());
};

// Main
// ----

let refreshTimeout;
function triggerRefresh(delay) {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }
  refreshTimeout = setTimeout(refresh.bind(ohmEditor), delay || 0);
}

function resetGrammarMatcher() {
  grammarMatcher = ohm.ohmGrammar.matcher();
  grammarMatcher.setInput(ohmEditor.ui.grammarEditor.getValue());
}

const checkboxes = $$('#options input[type=checkbox]');
checkboxes.forEach(function (cb) {
  cb.addEventListener('click', function (e) {
    const optionName = cb.name;

    // Respect the user's wishes if they automatically enable/disable "show failures".
    if (optionName === 'showFailures') {
      showFailuresImplicitly = false;
    }
    ohmEditor.options[optionName] = cb.checked;
    ohmEditor.emit('change:option', e.target.name);
    triggerRefresh();
  });
});

ohmEditor.setGrammar(null /* restore local storage */);

ohmEditor.ui.inputEditor.on('change', function (cm) {
  inputChanged = true;
  ohmEditor.emit('change:inputEditor', cm);
  triggerRefresh(250);
});

ohmEditor.ui.grammarEditor.on('beforeChange', function (cm, change) {
  grammarMatcher.replaceInputRange(
    cm.indexFromPos(change.from),
    cm.indexFromPos(change.to),
    change.text.join('\n')
  );
});

ohmEditor.ui.grammarEditor.on('swapDoc', resetGrammarMatcher);

ohmEditor.ui.grammarEditor.on('change', function (cm, change) {
  grammarChanged = true;
  ohmEditor.emit('change:grammarEditor', cm);
  triggerRefresh(250);
});
ohmEditor.ui.grammarEditor.on('swapDoc', function (cm) {
  grammarChanged = true;
  ohmEditor.emit('change:grammarEditor', cm);
  triggerRefresh(250);
});

window.ohmEditor = ohmEditor;

/* eslint-disable no-console */
console.log(
  '%cOhm visualizer',
  'color: #e0a; font-family: Avenir; font-size: 18px;'
);
console.log(
  [
    '- `ohm` is the Ohm library',
    '- `ohmEditor` is editor object with',
    '  `.grammar` as the current grammar object (if the source is valid)',
    '  `.ui` containing the `inputEditor` and `grammarEditor`',
    '',
    `Ohm version ${ohm.version}`
  ].join('\n')
);
/* eslint-enable no-console */

resetGrammarMatcher();
refresh();
