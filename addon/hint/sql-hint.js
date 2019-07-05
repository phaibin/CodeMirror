// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"), require("../../mode/sql/sql"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror", "../../mode/sql/sql"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  var tables;
  var defaultTable;
  var keywords;
  var identifierQuote;
  var CONS = {
    QUERY_DIV: ";",
    ALIAS_KEYWORD: "AS"
  };
  var Pos = CodeMirror.Pos, cmpPos = CodeMirror.cmpPos;

  function isArray(val) { return Object.prototype.toString.call(val) == "[object Array]" }

  function getKeywords(editor) {
    var mode = editor.doc.modeOption;
    if (mode === "sql") mode = "text/x-sql";
    return CodeMirror.resolveMode(mode).keywords;
  }

  function getIdentifierQuote(editor) {
    var mode = editor.doc.modeOption;
    if (mode === "sql") mode = "text/x-sql";
    return CodeMirror.resolveMode(mode).identifierQuote || "`";
  }

  function getText(item) {
    return typeof item == "string" ? item : item.text;
  }

  function wrapTable(name, value) {
    if (isArray(value)) value = {columns: value}
    if (!value.text) value.text = name
    return value
  }

  function parseTables(input) {
    var result = {}
    if (isArray(input)) {
      for (var i = input.length - 1; i >= 0; i--) {
        var item = input[i]
        result[getText(item).toUpperCase()] = wrapTable(getText(item), item)
      }
    } else if (input) {
      for (var name in input)
        result[name.toUpperCase()] = wrapTable(name, input[name])
    }
    return result
  }

  function getTable(name) {
    return tables[name.toUpperCase()]
  }

  function shallowClone(object) {
    var result = {};
    for (var key in object) if (object.hasOwnProperty(key))
      result[key] = object[key];
    return result;
  }

  function longestCommonSubstring(string1, string2) {
    // init max value
    var longestCommonSubstring = 0;
    // init 2D array with 0
    var table = [],
              len1 = string1.length,
              len2 = string2.length,
              row, col;
    for(row = 0; row <= len1; row++){
      table[row] = [];
      for(col = 0; col <= len2; col++){
        table[row][col] = 0;
      }
    }
    // fill table
          var i, j;
    for(i = 0; i < len1; i++){
      for(j = 0; j < len2; j++){
        if(string1[i] === string2[j]){
          if(table[i][j] === 0){
            table[i+1][j+1] = 1;
          } else {
            table[i+1][j+1] = table[i][j] + 1;
          }
          if(table[i+1][j+1] > longestCommonSubstring){
            longestCommonSubstring = table[i+1][j+1];
          }
        } else {
          table[i+1][j+1] = 0;
        }
      }
    }
    return longestCommonSubstring;
  }

  function match(string, word) {
    var lowerWord = getText(word).toLowerCase();
    var lowerString = string.toLowerCase();
    var m = false;
    var l = 0;
    if (lowerString.includes('.')) {
      var x = lowerString.split(/\.(.*)/);
      x = x.filter(function(value, index, arr) {
        return value !== '';
      })
      var reg = '^' + x[0] + '\\.' + '.*';
      if (x.length > 1) {
        reg = reg + x[1].split('').join('.*');
      }
      m = lowerWord.match(new RegExp(reg));
      if (m) {
        l = x[1] ? longestCommonSubstring(lowerWord, x[1]) : 0;
      }
    } else {
      m = lowerWord.match(new RegExp(lowerString.split('').join('.*')));
      if (m) {
        l = longestCommonSubstring(lowerWord, lowerString);
      }
    }
    return { match: m, commonLength: l };
  }

  function addMatches(result, search, wordlist, formatter) {
    if (isArray(wordlist)) {
      for (var i = 0; i < wordlist.length; i++) {
        var m = match(search, wordlist[i]);
        if (m.match) { result.push(formatter(wordlist[i], m.commonLength)); }
      }
    } else {
      for (var word in wordlist) if (wordlist.hasOwnProperty(word)) {
        var val = wordlist[word];
        if (!val || val === true)
          val = word;
        else
          val = val.displayText ? {text: val.text, displayText: val.displayText} : val.text;
        var m = match(search, val);
        if (m.match) { result.push(formatter(val, m.commonLength)) }
      }
    }
  }

  function cleanName(name) {
    // Get rid name from identifierQuote and preceding dot(.)
    if (name.charAt(0) == ".") {
      name = name.substr(1);
    }
    // replace doublicated identifierQuotes with single identifierQuotes
    // and remove single identifierQuotes
    var nameParts = name.split(identifierQuote+identifierQuote);
    for (var i = 0; i < nameParts.length; i++)
      nameParts[i] = nameParts[i].replace(new RegExp(identifierQuote,"g"), "");
    return nameParts.join(identifierQuote);
  }

  function insertIdentifierQuotes(name) {
    var nameParts = getText(name).split(".");
    for (var i = 0; i < nameParts.length; i++)
      nameParts[i] = identifierQuote +
        // doublicate identifierQuotes
        nameParts[i].replace(new RegExp(identifierQuote,"g"), identifierQuote+identifierQuote) +
        identifierQuote;
    var escaped = nameParts.join(".");
    if (typeof name == "string") return escaped;
    name = shallowClone(name);
    name.text = escaped;
    return name;
  }

  function nameCompletion(cur, token, result, editor) {
    // Try to complete table, column names and return start position of completion
    var useIdentifierQuotes = false;
    var nameParts = [];
    var start = token.start;
    var cont = true;
    while (cont) {
      cont = (token.string.charAt(0) == ".");
      useIdentifierQuotes = useIdentifierQuotes || (token.string.charAt(0) == identifierQuote);

      start = token.start;
      nameParts.unshift(cleanName(token.string));

      token = editor.getTokenAt(Pos(cur.line, token.start));
      if (token.string == ".") {
        cont = true;
        token = editor.getTokenAt(Pos(cur.line, token.start));
      }
    }

    // Try to complete table names
    var string = nameParts.join(".");
    addMatches(result, string, tables, function(w) {
      return { text: useIdentifierQuotes ? insertIdentifierQuotes(w) : w, commonLength: l };
    });

    // Try to complete columns from defaultTable
    addMatches(result, string, defaultTable, function(w) {
      return { text: useIdentifierQuotes ? insertIdentifierQuotes(w) : w, commonLength: l };
    });

    // Try to complete columns
    string = nameParts.pop();
    var table = nameParts.join(".");

    var alias = false;
    var aliasTable = table;
    // Check if table is available. If not, find table by Alias
    if (!getTable(table)) {
      var oldTable = table;
      table = findTableByAlias(table, editor);
      if (table !== oldTable) alias = true;
    }

    var columns = getTable(table);
    if (columns && columns.columns)
      columns = columns.columns;

    if (columns) {
      addMatches(result, string, columns, function(w) {
        var tableInsert = table;
        if (alias == true) tableInsert = aliasTable;
        if (typeof w == "string") {
          w = tableInsert + "." + w;
        } else {
          w = shallowClone(w);
          w.text = tableInsert + "." + w.text;
        }
        return { text: useIdentifierQuotes ? insertIdentifierQuotes(w) : w, commonLength: l };
      });
    }

    return start;
  }

  function eachWord(lineText, f) {
    var words = lineText.split(/\s+/)
    for (var i = 0; i < words.length; i++)
      if (words[i]) f(words[i].replace(/[,;]/g, ''))
  }

  function findTableByAlias(alias, editor) {
    var doc = editor.doc;
    var fullQuery = doc.getValue();
    var aliasUpperCase = alias.toUpperCase();
    var previousWord = "";
    var table = "";
    var separator = [];
    var validRange = {
      start: Pos(0, 0),
      end: Pos(editor.lastLine(), editor.getLineHandle(editor.lastLine()).length)
    };

    //add separator
    var indexOfSeparator = fullQuery.indexOf(CONS.QUERY_DIV);
    while(indexOfSeparator != -1) {
      separator.push(doc.posFromIndex(indexOfSeparator));
      indexOfSeparator = fullQuery.indexOf(CONS.QUERY_DIV, indexOfSeparator+1);
    }
    separator.unshift(Pos(0, 0));
    separator.push(Pos(editor.lastLine(), editor.getLineHandle(editor.lastLine()).text.length));

    //find valid range
    var prevItem = null;
    var current = editor.getCursor()
    for (var i = 0; i < separator.length; i++) {
      if ((prevItem == null || cmpPos(current, prevItem) > 0) && cmpPos(current, separator[i]) <= 0) {
        validRange = {start: prevItem, end: separator[i]};
        break;
      }
      prevItem = separator[i];
    }

    if (validRange.start) {
      var query = doc.getRange(validRange.start, validRange.end, false);

      for (var i = 0; i < query.length; i++) {
        var lineText = query[i];
        eachWord(lineText, function(word) {
          var wordUpperCase = word.toUpperCase();
          if (wordUpperCase === aliasUpperCase && getTable(previousWord))
            table = previousWord;
          if (wordUpperCase !== CONS.ALIAS_KEYWORD)
            previousWord = word;
        });
        if (table) break;
      }
    }
    return table;
  }

  CodeMirror.registerHelper("hint", "sql", function(editor, options) {
    tables = parseTables(options && options.tables)
    var defaultTableName = options && options.defaultTable;
    var disableKeywords = options && options.disableKeywords;
    defaultTable = defaultTableName && getTable(defaultTableName);
    keywords = getKeywords(editor);
    identifierQuote = getIdentifierQuote(editor);

    if (defaultTableName && !defaultTable)
      defaultTable = findTableByAlias(defaultTableName, editor);

    defaultTable = defaultTable || [];

    if (defaultTable.columns)
      defaultTable = defaultTable.columns;

    var cur = editor.getCursor();
    var result = [];
    var token = editor.getTokenAt(cur), start, end, search;
    if (token.end > cur.ch) {
      token.end = cur.ch;
      token.string = token.string.slice(0, cur.ch - token.start);
    }

    if (token.string.match(/^[.`\w@]\w*$/)) {
      search = token.string;
      start = token.start;
      end = token.end;
    } else {
      start = end = cur.ch;
      search = "";
    }
    if (search) {
	    if (search.charAt(0) == "." || search.charAt(0) == identifierQuote) {
        start = nameCompletion(cur, token, result, editor);
        result.sort(function(a, b) { return a.commonLength > b.commonLength ? -1 : 1 });
        result = result.map(function(a) { return a.text });
	    } else {
	      var objectOrClass = function(w, l, className) {
	        if (typeof w === "object") {
            w.commonLength = l;
            w.className = className;
	        } else {
	          w = { text: w, commonLength: l, className: className };
	        }
	        return w;
	      };
		    addMatches(result, search, defaultTable, function(w, l) {
		        return objectOrClass(w, l, "CodeMirror-hint-table CodeMirror-hint-default-table");
		    });
		    addMatches(
		        result,
		        search,
		        tables, function(w, l) {
		          return objectOrClass(w, l, "CodeMirror-hint-table");
		        }
		    );
		    if (!disableKeywords)
		      addMatches(result, search, keywords, function(w, l) {
		          return objectOrClass(w.toUpperCase(), l, "CodeMirror-hint-keyword");
          });
        result.sort(function(a, b) { return a.commonLength > b.commonLength ? -1 : 1 });
		  }
		}
    return {list: result, from: Pos(cur.line, start), to: Pos(cur.line, end)};
  });
});
