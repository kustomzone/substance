import extend from 'lodash/extend'
import isPlainObject from 'lodash/isPlainObject'
import EventEmitter from '../util/EventEmitter'
import TransactionDocument from './TransactionDocument'
import DefaultChangeCompressor from './DefaultChangeCompressor'
import Selection from './Selection'
import SelectionState from './SelectionState'
import DocumentChange from './DocumentChange'

var __id__ = 0

class DocumentSession extends EventEmitter {

  constructor(doc, options) {
    super()

    this.__id__ = __id__++

    options = options || {}
    this.doc = doc
    this.selectionState = new SelectionState(doc)

    // the stage is a essentially a clone of this document
    // used to apply a sequence of document operations
    // without touching this document
    this.stage = new TransactionDocument(this.doc, this)
    this.isTransacting = false

    this.doneChanges = []
    this.undoneChanges = []
    this._lastChange = null

    this.compressor = options.compressor || new DefaultChangeCompressor()
    this.saveHandler = options.saveHandler

    // Note: registering twice:
    // to do internal transformations in case changes are coming
    // in from another session -- this must be done as early as possible
    this.doc.on('document:changed', this.onDocumentChange, this, {priority: 1000})
  }

  getDocument() {
    return this.doc
  }

  getSelection() {
    return this.selectionState.getSelection()
  }

  setSelection(sel) {
    if (sel && isPlainObject(sel)) {
      sel = this.doc.createSelection(sel)
    }
    var selectionHasChanged = this._setSelection(sel)
    if(selectionHasChanged) {
      this._triggerUpdateEvent({
        selection: sel
      })
    }
  }

  createSelection() {
    return this.doc.createSelection.apply(this.doc, arguments)
  }

  getSelectionState() {
    return this.selectionState
  }

  /*
    Set saveHandler via API

    E.g. if saveHandler not available at construction
  */
  setSaveHandler(saveHandler) {
    this.saveHandler = saveHandler
  }

  getCollaborators() {
    return null
  }

  canUndo() {
    return this.doneChanges.length > 0
  }

  canRedo() {
    return this.undoneChanges.length > 0
  }

  undo() {
    this._undoRedo('undo')
  }

  redo() {
    this._undoRedo('redo')
  }


  _undoRedo(which) {
    var from, to
    if (which === 'redo') {
      from = this.undoneChanges
      to = this.doneChanges
    } else {
      from = this.doneChanges
      to = this.undoneChanges
    }
    var change = from.pop()
    if (change) {
      this.stage._apply(change)
      this.doc._apply(change)
      var sel = change.after.selection
      if (sel) {
        sel.attach(this.doc)
      }
      var selectionHasChanged = this._setSelection(sel)
      to.push(change.invert())
      var update = {
        change: change
      }
      if (selectionHasChanged) update.selection = sel
      this._triggerUpdateEvent(update, { replay: true })
    } else {
      console.warn('No change can be %s.', (which === 'undo'? 'undone':'redone'))
    }
  }

  /**
    Start a transaction to manipulate the document

    @param {function} transformation a function(tx) that performs actions on the transaction document tx

    @example

    ```js
    doc.transaction(function(tx, args) {
      tx.update(...)
      ...
      return {
        selection: newSelection
      }
    })
    ```
  */
  transaction(transformation, info) {
    if (this.isTransacting) {
      throw new Error('Nested transactions are not supported.')
    }
    this.isTransacting = true
    this.stage.reset()
    var sel = this.getSelection()
    info = info || {}
    var surfaceId = sel.surfaceId
    var change = this.stage._transaction(function(tx) {
      tx.before.selection = sel
      var args = { selection: sel }
      var result = transformation(tx, args) || {}
      sel = result.selection || sel
      if (sel._isSelection && !sel.isNull() && !sel.surfaceId) {
        sel.surfaceId = surfaceId
      }
      tx.after.selection = sel
      extend(info, tx.info)
    })
    if (change) {
      this.isTransacting = false
      this._commit(change, info)
      return change
    } else {
      this.isTransacting = false
    }
  }

  onDocumentChange(change, info) {
    // ATTENTION: this is used if you have two independent DocumentSessions
    // in one client.
    if (info && info.session !== this) {
      this.stage._apply(change)
      this._transformLocalChangeHistory(change, info)
      var update = {
        change: change
      }
      var newSelection = this._transformSelection(change, info)
      var selectionHasChanged = this._setSelection(newSelection)
      if (selectionHasChanged) update.selection = newSelection
      // this._triggerUpdateEvent(update, info)
    }
  }

  _setSelection(sel) {
    return this.selectionState.setSelection(sel)
  }

  _transformLocalChangeHistory(externalChange) {
    // Transform the change history
    // Note: using a clone as the transform is done inplace
    // which is ok for the changes in the undo history, but not
    // for the external change
    var clone = {
      ops: externalChange.ops.map(function(op) { return op.clone(); })
    }
    DocumentChange.transformInplace(clone, this.doneChanges)
    DocumentChange.transformInplace(clone, this.undoneChanges)
  }

  _transformSelection(change) {
    var oldSelection = this.getSelection()
    var newSelection = DocumentChange.transformSelection(oldSelection, change)
    // console.log('Transformed selection', change, oldSelection.toString(), newSelection.toString())
    return newSelection
  }

  _commit(change, info) {
    var selectionHasChanged = this._commitChange(change)
    var update = {
      change: change
    }
    if (selectionHasChanged) update.selection = this.getSelection()
    this._triggerUpdateEvent(update, info)
  }

  _commitChange(change) {
    change.timestamp = Date.now()
    // update document model
    this.doc._apply(change)

    var currentChange = this._currentChange
    // try to merge this change with the last to get more natural changes
    // e.g. not every keystroke, but typed words or such.
    var merged = false
    if (currentChange) {
      if (this.compressor.shouldMerge(currentChange, change)) {
        merged = this.compressor.merge(currentChange, change)
      }
    }
    if (!merged) {
      // push to undo queue and wipe the redo queue
      this._currentChange = change
      this.doneChanges.push(change.invert())
    }
    // discard old redo history
    this.undoneChanges = []

    var newSelection = change.after.selection || Selection.nullSelection
    var selectionHasChanged = this._setSelection(newSelection)
    // HACK injecting the surfaceId here...
    // TODO: we should find out where the best place is to do this
    if (!newSelection.isNull()) {
      newSelection.surfaceId = change.after.surfaceId
    }
    return selectionHasChanged
  }

  /*
    Are there unsaved changes?
  */
  isDirty() {
    return this._dirty
  }

  /*
    Save session / document
  */
  save() {
    var doc = this.getDocument()
    var saveHandler = this.saveHandler

    if (this._dirty && !this._isSaving) {
      this._isSaving = true
      // Pass saving logic to the user defined callback if available
      if (saveHandler) {
        // TODO: calculate changes since last save
        var changes = []
        saveHandler.saveDocument(doc, changes, function(err) {

          this._isSaving = false
          if (err) {
            console.error('Error during save')
          } else {
            this._dirty = false
            this._triggerUpdateEvent({}, {force: true})
          }
        }.bind(this))

      } else {
        console.error('Document saving is not handled at the moment. Make sure saveHandler instance provided to documentSession')
      }
    }
  }

  _triggerUpdateEvent(update, info) {
    info = info || {}
    info.session = this
    if (update.change && update.change.ops.length > 0) {
      // TODO: I would like to wrap this with a try catch.
      // however, debugging gets inconvenient as caught exceptions don't trigger a breakpoint
      // by default, and other libraries such as jquery throw noisily.
      this.doc._notifyChangeListeners(update.change, info)
      this._dirty = true
    } else {
      // HACK: removing this from the update when it is NOP
      // this way, we only need to do this check here
      delete update.change
    }
    if (Object.keys(update).length > 0 || info.force) {
      // slots to have more control about when things get
      // updated, and things have been rendered/updated
      this.emit('update', update, info)
      this.emit('didUpdate', update, info)
    }
  }
}

export default DocumentSession
