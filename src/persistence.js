/* eslint-env browser */
/* global CodeMirror, saveAs, GitHub */

'use strict';

var ohmEditor = require('./ohmEditor');
var domUtil = require('./domUtil');
var restoreExamples = require('./examples').restoreExamples;
var getExamples = require('./examples').getExamples;

function initLocal() {
  var $ = domUtil.$;

  $('#grammars').hidden = false;

  var loadedGrammar = 'unnamed.ohm';
  var grammarName = $('#grammarName');

  var loadButton = $('#loadGrammar');
  var grammarFile = $('#grammarFile');
  loadButton.addEventListener('click', function(e) {
    grammarFile.click();
  });
  grammarFile.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) {
      return;
    }
    var reader = new FileReader();
    var filename = file.name;
    reader.onload = function(e) {
      var src = e.target.result;
      loadedGrammar = filename;
      grammarName.textContent = filename;
      grammarName.classList.remove('unnamed');

      ohmEditor.ui.grammarEditor.setValue(src);
    };
    reader.readAsText(file);
  }, false);

  var saveButton = $('#saveGrammar');
  saveButton.addEventListener('click', function(e) {
    var src = ohmEditor.ui.grammarEditor.getValue();
    // var url = 'data:application/stream;base64,' + btoa(src);
    // window.location = url;

    // use application/octet-stream to force download (not text/ohm-js;charset=utf-8)
    var blob = new Blob([src], {type: 'application/octet-stream'});
    saveAs(blob, loadedGrammar);
  });

  // local storage
  ohmEditor.addListener('change:grammar', function(source) {
    ohmEditor.saveState(ohmEditor.ui.grammarEditor, 'grammar');
  });
}

function initServer(grammars) {
  var $ = domUtil.$;
  var $$ = domUtil.$$;

  $('#grammars').hidden = false;
  $('#grammarName').hidden = true;
  $('#saveIndicator').hidden = false;
  $('#loadGrammar').hidden = true;

  var saveButton = $('#saveGrammar');
  saveButton.textContent = 'Save as...';

  // -------------------------------------------------------
  // PROMPT STUFF
  // -------------------------------------------------------

  function showPrompt(dialogId) {
    $('#promptScreen').style.display = 'block';
    Array.prototype.slice.apply($$('#promptScreen > *')).forEach(function(dialog) {
      dialog.hidden = true;
    });
    $('#' + dialogId).hidden = false;
  }
  function hidePrompt() {
    $('#promptScreen').style.display = 'none';
    Array.prototype.slice.apply($$('#promptScreen > *')).forEach(function(dialog) {
      dialog.hidden = true;
    });
  }
  Array.prototype.slice.apply($$('#promptScreen .close')).forEach(function(close) {
    close.addEventListener('click', hidePrompt);
  });

  // -------------------------------------------------------
  // GITHUB LOAD GRAMMARS (GISTS)
  // -------------------------------------------------------

  var grammarList = $('#grammarList');
  grammarList.hidden = false;

  var gitHub = new GitHub();

  function loadFromGist(gistHash, cb) {
    var gist = gitHub.getGist(gistHash);
    gist.read(function(err, res, req) {
      var grammarFilename = Object.getOwnPropertyNames(res.files).find(function(filename) {
        return filename.slice(-4) === '.ohm';
      });
      var exampleFilename = Object.getOwnPropertyNames(res.files).find(function(filename) {
        return filename.slice(-5) === '.json';
      });

      var grammarFile = res.files[grammarFilename];
      var exampleFile = res.files[exampleFilename];
      cb(grammarFile && grammarFile.content, exampleFile && exampleFile.content);
    });
  }

  function addGrammarGroup(list, label, grammars, beforeElem) {
    var group = list.querySelector('*[label="My Grammars"]');
    if (group) {
      group.remove();
    }
    group = document.createElement('optgroup');
    group.setAttribute('label', label);
    list.add(group);

    if (!(grammars instanceof Array)) {
      grammars = [];
    }

    grammars.forEach(function(grammarHash) {
      var option = document.createElement('option');
      option.value = grammarHash;
      var gist = gitHub.getGist(grammarHash);
      gist.read(function(err, res) {
        if (err) {
          console.warn('Could not load Gist ' + grammarHash); // eslint-disable-line no-console
          return;
        }
        option.text = res.description;
        if (beforeElem) {
          group.insertBefore(option, beforeElem);
        } else {
          group.appendChild(option);
        }
      });
    });

    return group;
  }

  function loadUserGrammars(ghUser) {
    ghUser.listGists(function(err, res) {
      if (err) {
        console.log('Error loading Gists: ' + err.message + '(' + err.status + ')'); // eslint-disable-line no-console
        return;
      }
      var grammars = res
        .filter(function(gist) {
          var filenames = Object.getOwnPropertyNames(gist.files);
          var hasJSON = filenames.find(function(filename) { return filename.toLowerCase().slice(-5) === '.json'; });
          var hasOhm = filenames.find(function(filename) { return filename.toLowerCase().slice(-4) === '.ohm'; });
          return hasJSON && hasOhm;
        })
        .sort(function(a, b) { return a.description < b.description; })
        .map(function(gist) { return gist.id; });

      localStorage.setItem('gitHubAuth', btoa(JSON.stringify(ghUser.__auth)));

      var option = document.createElement('option');
      option.value = '!logout';
      option.text = '[Logout]';

      var group = addGrammarGroup(grammarList, 'My Grammars', grammars, option);

      group.appendChild(option);
    });
  }

  addGrammarGroup(grammarList, 'Official Ohm Grammars', grammars.official);

  var gitHubAuth = localStorage.getItem('gitHubAuth');
  if (gitHubAuth) {
    gitHub = new GitHub(JSON.parse(atob(gitHubAuth)));
    loadUserGrammars(gitHub.getUser());
  } else {
    var group = addGrammarGroup(grammarList, 'My Grammars');
    var option = document.createElement('option');
    option.value = '!login';
    option.text = '[Log into GitHub...]';
    group.appendChild(option);
  }

  $('#gitHubForm').addEventListener('submit', function(e) {
    hidePrompt();

    var username = $('#username').value;
    $('#username').value = '';
    var password = $('#password').value;
    $('#password').value = '';
    gitHub = new GitHub({username: username, password: password});
    loadUserGrammars(gitHub.getUser());

    localStorage.removeItem('gitHubAuth');

    e.preventDefault();
    return false;
  });

  // -------------------------------------------------------
  // GITHUB ADD GRAMMARS (GISTS)
  // -------------------------------------------------------

  function saveToGist(description, grammarName, grammarText, examples, gistIdOrNull) {
    var gist = gitHub.getGist(gistIdOrNull);
    var gistData = {
      description: description,
      public: false,
      files: {}
    };
    gistData.files[grammarName + '.ohm'] = {
      content: grammarText,
      type: 'text/ohm-js'
    };
    gistData.files[grammarName + '.json'] = {
      content: JSON.stringify(
        Object.keys(examples).map(function(key) {
          return examples[key];
        }), null, 2
      ),
      type: 'application/json'
    };

    gist[gistIdOrNull ? 'update' : 'create'](gistData, function(err, res) {
      if (!gistIdOrNull) {
        var gistId = res.id;
        var group = grammarList.querySelector('optGroup[label="My Grammars"]');
        var option = document.createElement('option');
        option.value = gistId;
        option.text = description;
        group.insertBefore(option, group.lastChild);
        grammarList.value = gistId;
      }

      $('#saveIndicator').classList.remove('edited');
    });
  }

  saveButton.addEventListener('click', function(e) {
    if (saveButton.textContent === 'Save') {
      // FIXME: can only be checked if changes to examples are also noted
      // var active = $('#saveIndicator').classList.contains('edited');
      // if (!active) {
      //   return;
      // }

      var option = grammarList.options[grammarList.selectedIndex];
      var grammarHash = option.value;

      var description = option.label;
      var grammarName = (ohmEditor.grammar && ohmEditor.grammar.name) || 'grammar';
      var grammarText = ohmEditor.ui.grammarEditor.getValue();
      var examples = getExamples();

      saveToGist(description, grammarName, grammarText, examples, grammarHash);
    } else { // save as
      showPrompt('newGrammarBox');
      $('#newGrammarName').focus();
    }
  });
  $('#newGrammarForm').addEventListener('submit', function(e) {
    hidePrompt();

    var description = $('#newGrammarName').value;
    var grammarName = (ohmEditor.grammar && ohmEditor.grammar.name) || 'grammar';
    var grammarText = ohmEditor.ui.grammarEditor.getValue();
    var examples = getExamples();

    saveToGist(description, grammarName, grammarText, examples);

    e.preventDefault();
    return false;
  });
  $('#newGrammarForm').addEventListener('reset', function(e) {
    hidePrompt();
  });

  // -------------------------------------------------------
  // GRAMMAR SELECTION
  // -------------------------------------------------------

  var prevSelection;
  grammarList.addEventListener('click', function(e) {
    prevSelection = grammarList.selectedIndex;
  });

  grammarList.addEventListener('change', function(e) {
    var grammarHash = grammarList.options[grammarList.selectedIndex].value;
    if (grammarHash === '') { // local storage
      ohmEditor.restoreState(ohmEditor.ui.grammarEditor, 'grammar', $('#sampleGrammar'));
      restoreExamples('examples');
      saveButton.textContent = 'Save as...';
      return false;
    } else if (grammarHash === '!login') {
      showPrompt('loginBox');
      grammarList.selectedIndex = prevSelection;
      return;
    } else if (grammarHash === '!logout') {
      localStorage.removeItem('gitHubAuth');

      var group = addGrammarGroup(grammarList, 'My Grammars');
      var option = document.createElement('option');
      option.value = '!login';
      option.text = '[Log into GitHub...]';
      group.appendChild(option);

      if ((grammarList.options.length - 1) > prevSelection) {
        grammarList.selectedIndex = prevSelection;
      } else {
        grammarList.selectedIndex = 0; // select local storage
      }
      return;
    }

    var optGroup = grammarList.options[grammarList.selectedIndex].parentElement;
    if (optGroup.label === 'My Grammars') {
      saveButton.textContent = 'Save';
    } else {
      saveButton.textContent = 'Save as...';
    }
    loadFromGist(grammarHash, function(src, examplesJSON) {
      ohmEditor.once('change:grammar', function(_) {
        $('#saveIndicator').classList.remove('edited');
      });
      if (!examplesJSON) {
        examplesJSON = '[]';
      }
      ohmEditor.once('parse:grammar', function(matchResult, grammar, err) {
        restoreExamples(JSON.parse(examplesJSON));
      });

      restoreExamples([]); // clear examples
      var doc = CodeMirror.Doc(src, 'null');
      ohmEditor.ui.grammarEditor.swapDoc(doc);
    });
  });

  ohmEditor.ui.grammarEditor.setOption('extraKeys', {
    'Cmd-S': function(cm) {
      var grammar = grammarList.options[grammarList.selectedIndex].value;
      if (grammar === '') {
        return;
      }

      postToURL('../grammars/' + grammar, cm.getValue(), function(response) {
        $('#saveIndicator').classList.remove('edited');
      });
    }
  });

  ohmEditor.addListener('change:grammar', function(source) {
    var grammar = grammarList.options[grammarList.selectedIndex].value;
    if (grammar === '') { // local storage
      ohmEditor.saveState(ohmEditor.ui.grammarEditor, 'grammar');
    } else {
      $('#saveIndicator').classList.add('edited');
    }
  });
}

// Main
// -------

if (window.location.protocol !== 'file:') {
  var grammars = {
    official: [
      '7f62adb8df879a5eb8288dbbddcc663f' // Arithmetic
    ]
  };
  initServer(grammars);
} else {
  initLocal();
}

// Exports
// -------

module.exports = {
  local: initLocal,
  server: initServer
};
