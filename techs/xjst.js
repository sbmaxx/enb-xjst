var EOL = require('os').EOL,
    path = require('path'),
    vow = require('vow'),
    vfs = require('enb/lib/fs/async-fs'),
    pinpoint = require('pinpoint'),
    SourceMap = require('../lib/source-map'),
    bundle = require('../lib/bundle');

/**
 * @class XjstTech
 * @augments {BaseTech}
 * @classdesc
 *
 * Compiles XJST template files with XJST translator and merges them into a single template bundle.<br/><br/>
 *
 * Important: Normally you don't need to use this tech directly.
 *
 * @param {Object}      [options]                       Options
 * @param {String}      [options.target='?.xjst.js']    Path to a target with compiled file.
 */
module.exports = require('enb/lib/build-flow').create()
    .name('xjst')
    .target('target', '?.xjst.js')
    .builder(function (sourceFiles) {
        return this._readSourceFiles(sourceFiles)
            .then(function (fileSources) {
                var sourceMap = SourceMap(fileSources),
                    code = sourceMap.getCode();

                return this._xjstProcess(code, sourceMap);
            }, this);
    })
    .methods({
        /**
         * Reads source files from local file system.
         * @param {Object[]} sourceFiles — objects that contain file information.
         * @returns {Promise}
         * @protected
         */
        _readSourceFiles: function (sourceFiles) {
            return vow.all(sourceFiles.map(function (file) {
                return vfs.read(file.fullname, 'utf8')
                    .then(function (contents) {
                        return {
                            source: contents,
                            filename: file.fullname
                        };
                    });
            }));
        },

        /**
         * Merges content of source files and runs XJST processing for merged code.
         * @param {String} code for processing.
         * @param {SourceMap} object with sourceMap model.
         * @returns {Promise}
         * @private
         */
        _xjstProcess: function (code, sourceMap) {
            var jobQueue = this.node.getSharedResources().jobQueue,
                template = [
                    'this._mode === "", !this.require: applyNext(this.require = function (lib) {',
                    '    return __xjst_libs__[lib];',
                    '})'
                ].join(EOL);

            code += EOL + template;

            this.node.getLogger().log('Calm down, OmetaJS is running...');
            return jobQueue.push(
                    path.resolve(__dirname, '../lib/xjst-processor'),
                    code,
                    this._getOptions()
                )
                .then(function (result) {
                    return bundle.compile(result, {
                        dirname: this.node.getDir(),
                        exportName: this._exportName,
                        includeVow: this._includeVow,
                        requires: this._requires
                    });
                }, this)
                .fail(function (error) {
                    throw this._generateError(error, sourceMap);
                }, this);
        },

        /**
         * Error handler function.
         * @param {Error} error which occurs while XJST processing.
         * @param {SourceMap} sourceMap model object.
         * @returns {SyntaxError|*}
         * @protected
         */
        _generateError: function (error, sourceMap) {
            var line = error.line,
                column = error.column;

            // Syntax Error
            if (line && column) {
                var original = sourceMap.getOriginal(line, column);

                if (original) {
                    var message = error.message.split('\n')[0].replace(/\sat\:\s(\d)+\:(\d)+/, ''),
                        relPath = path.relative(this.node._root, original.filename),
                        context = pinpoint(original.source, {
                            line: original.line,
                            column: original.column,
                            indent: '    '
                        });

                    if (relPath.charAt(0) !== '.') {
                        relPath = './' + relPath;
                    }

                    return new SyntaxError(message + ' at ' + relPath + '\n' + context);
                } else {
                    return error;
                }
            } else {
                return error;
            }
        },

        /**
         * Returns configuration object for XJST processor.
         * @returns {Object}
         * @protected
         */
        _getOptions: function () {
            return {
                devMode: this._devMode,
                cache: this._cache,
                exportName: this._exportName,
                applyFuncName: this._applyFuncName
            };
        }
    })
    .createTech();
