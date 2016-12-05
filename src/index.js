/* eslint-env browser */
/* global CodeMirror, ohm */

'use strict';

var domUtil = require('./domUtil');
var ohmEditor = require('./ohmEditor');

require('./editorErrors');
require('./examples');
require('./exampleGenerationRequests');  // Required for examples.
require('./externalRules');
require('./semanticsHelper');
require('./semantics');
require('./parseTree');
require('./ruleHyperlinks');
require('./searchBar');
require('./splitters');
require('./timeline');

var checkboxes;
var grammarChanged = true;
var inputChanged = true;

var showFailuresImplicitly = true;

var $ = domUtil.$;
var $$ = domUtil.$$;

var grammarMatcher = ohm.ohmGrammar.matcher();

// Helpers
// -------

function parseGrammar() {
  var matchResult = grammarMatcher.match();

  var grammar;
  var err;

  if (matchResult.succeeded()) {
    var ns = {};
    try {
      ohm._buildGrammar(matchResult, ns);
      var firstProp = Object.keys(ns)[0];
      if (firstProp) {
        grammar = ns[firstProp];
      }
    } catch (ex) {
      err = ex;
    }
  } else {
    err = {
      message: matchResult.message,
      shortMessage: matchResult.shortMessage,
      interval: matchResult.getInterval()
    };
  }
  return {
    matchResult: matchResult,
    grammar: grammar,
    error: err
  };
}

function refresh() {
  var grammarEditor = ohmEditor.ui.grammarEditor;
  var inputEditor = ohmEditor.ui.inputEditor;

  var grammarSource = grammarEditor.getValue();
  var inputSource = inputEditor.getValue();

  ohmEditor.saveState(inputEditor, 'input');

  // Refresh the option values.
  for (var i = 0; i < checkboxes.length; ++i) {
    var checkbox = checkboxes[i];
    ohmEditor.options[checkbox.name] = checkbox.checked;
  }

  if (inputChanged || grammarChanged) {
    showFailuresImplicitly = true;  // Reset to default.
  }

  if (inputChanged) {
    inputChanged = false;
    ohmEditor.emit('change:input', inputSource);
  }

  if (grammarChanged) {
    grammarChanged = false;
    ohmEditor.emit('change:grammar', grammarSource);

    var result = parseGrammar();
    ohmEditor.grammar = result.grammar;
    ohmEditor.emit('parse:grammar', result.matchResult, result.grammar, result.error);
  }

  if (ohmEditor.grammar && ohmEditor.grammar.defaultStartRule) {
    var trace = ohmEditor.grammar.trace(inputSource, ohmEditor.startRule);

    // When the input fails to parse, turn on "show failures" automatically.
    if (showFailuresImplicitly) {
      var checked = $('input[name=showFailures]').checked = trace.result.failed();
      ohmEditor.options.showFailures = checked;
    }

    ohmEditor.emit('parse:input', trace.result, trace);
  }
}

ohmEditor.restoreState = function(editor, key, defaultEl) {
  var value = localStorage.getItem(key);
  var doc;
  if (value) {
    doc = CodeMirror.Doc(value, 'null');
  } else if (defaultEl) {
    doc = CodeMirror.Doc(defaultEl.textContent, 'null');
  }
  ohmEditor.ui.grammarEditor.swapDoc(doc);
};

ohmEditor.saveState = function(editor, key) {
  localStorage.setItem(key, editor.getValue());
};

// Main
// ----

var refreshTimeout;
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

checkboxes = $$('#options input[type=checkbox]');
checkboxes.forEach(function(cb) {
  cb.addEventListener('click', function(e) {
    // Respect the user's wishes if they automatically enable/disable "show failures".
    if (e.target.name === 'showFailures') {
      showFailuresImplicitly = false;
    } else if (e.target.name === 'showExampleGenerator') {
      $$('.exampleGeneratorUI').forEach(function(el) {
        el.classList.toggle('hidden', !e.target.checked);
      });
    }
    triggerRefresh();
  });
});

ohmEditor.restoreState(ohmEditor.ui.grammarEditor, 'grammar', $('#sampleGrammar'));

ohmEditor.ui.inputEditor.on('change', function(cm) {
  inputChanged = true;
  ohmEditor.emit('change:inputEditor', cm);
  triggerRefresh(250);
});

ohmEditor.ui.grammarEditor.on('beforeChange', function(cm, change) {
  grammarMatcher.replaceInputRange(
      cm.indexFromPos(change.from),
      cm.indexFromPos(change.to),
      change.text.join('\n'));
});

ohmEditor.ui.grammarEditor.on('swapDoc', resetGrammarMatcher);

ohmEditor.ui.grammarEditor.on('change', function(cm, change) {
  grammarChanged = true;
  ohmEditor.emit('change:grammarEditor', cm);
  triggerRefresh(250);
});

/* eslint-disable no-console */
console.log('%cOhm visualizer', 'color: #e0a; font-family: Avenir; font-size: 18px;');
console.log([
  '- `ohm` is the Ohm library',
  '- `ohmEditor` is editor object with',
  '  `.grammar` as the current grammar object (if the source is valid)',
  '  `.ui` containing the `inputEditor` and `grammarEditor`'
].join('\n'));
/* eslint-enable no-console */

resetGrammarMatcher();
refresh();
