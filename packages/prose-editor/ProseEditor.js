import AbstractEditor from '../../ui/AbstractEditor'
import ContainerEditor from '../../ui/ContainerEditor'
import ProseEditorOverlayTools from './ProseEditorOverlayTools'

class ProseEditor extends AbstractEditor {

  willUpdateState(newState) {
    this.handleStateUpdate(newState)
  }

  render($$) {
    let SplitPane = this.componentRegistry.get('split-pane')
    let el = $$('div').addClass('sc-prose-editor')
    let toolbar = this._renderToolbar($$)
    let editor = this._renderEditor($$)
    let ScrollPane = this.componentRegistry.get('scroll-pane')

    let contentPanel = $$(ScrollPane, {
      scrollbarType: 'substance',
      scrollbarPosition: 'right',
      overlay: ProseEditorOverlayTools,
    }).append(
      editor
    ).ref('contentPanel')

    el.append(
      $$(SplitPane, {splitType: 'horizontal'}).append(
        toolbar,
        contentPanel
      )
    )
    return el
  }

  _renderToolbar($$) {
    let configurator = this.props.configurator
    let ToolbarClass = configurator.getToolbarClass()
    let commandStates = this.commandManager.getCommandStates()
    return $$(ToolbarClass, {
      commandStates: commandStates
    }).ref('toolbar')
  }

  _renderEditor($$) {
    let configurator = this.props.configurator
    return $$(ContainerEditor, {
      disabled: this.props.disabled,
      documentSession: this.documentSession,
      node: this.doc.get('body'),
      commands: configurator.getSurfaceCommandNames(),
      textTypes: configurator.getTextTypes()
    }).ref('body')
  }

  getToolbar() {
    return this.refs.toolbar
  }

  documentSessionUpdated() {
    let toolbar = this.getToolbar()
    if (toolbar) {
      let commandStates = this.commandManager.getCommandStates()
      toolbar.setProps({
        commandStates: commandStates
      })
    }
  }
}

export default ProseEditor
