import extend from 'lodash/extend'
import forEach from 'lodash/forEach'
import isArray from 'lodash/isArray'
import keyBy from 'lodash/keyBy'
import EventEmitter from '../util/EventEmitter'
import TreeIndex from '../util/TreeIndex'

/*
  Defines a list of stages which are used to register listeners
  which are called in appropriate order to either accumulate state
  or work on state updates, such rerendering things.
*/
class Flow extends EventEmitter {

  constructor(stages, context) {
    super()

    this.context = context
    this._graph = new Flow.Graph(stages)
    this._state = {}

    this._isFlowing = false
  }

  getStageNames() {
    var names = this._graph._sortedStages.map(function(stage) {
      return stage.name
    })
    return names
  }

  setState(name, state) {
    this._state[name] = state
    this._process(name)
  }

  updateState(name, state) {
    this.setState(extend(this._state[name], state))
  }

  _process(name) {
    if (this._isFlowing) return
    try {
      this._isFlowing = true
      var graph = this._graph
      var stages = graph.stages
      var queue = [name]
      while (queue.length > 0) {
        var stageName = queue.shift()
        var stage = stages[stageName]
        if (!stage) {
          throw new Error('Unknown stage ' + stageName)
        }
        this._processStage(stage)
        queue = queue.concat(graph.outEdges.get(stageName))
      }
    } finally {
      this._isFlowing = false
    }
  }

  _processStage(stage) {
    var name = stage.name
    this.emit('before:'+name, this)
    this.emit(name, this._state[name], this)
    this.emit('after:'+name, this)
  }

  before(name, fn, context, options) { // eslint-disable-line
    this.on.apply(this, ['before:'+name].concat(Array.prototype.slice.call(arguments, 1)))
  }

  after(name, fn, context, options) { // eslint-disable-line
    this.on.apply(this, ['after:'+name].concat(Array.prototype.slice.call(arguments, 1)))
  }

}

class Graph {
  constructor(stages) {
    if (isArray(stages)) {
      stages = keyBy(stages, 'name')
    }
    this.inEdges = null
    this.outEdges = null
    this.stages = stages
    this._sortedStages = null

    this._extractEdges(stages)
    this._compileStages(stages)
  }

  _extractEdges(stages) {
    var inEdges = new TreeIndex.Arrays()
    var outEdges = new TreeIndex.Arrays()
    forEach(stages, function(stage) {
      inEdges.create(stage.name)
      outEdges.create(stage.name)
      // add edges for given requirements
      if (stage.requires) {
        stage.requires.forEach(function(other) {
          // 'in' means that the first has a requirement fulfilled by the second
          inEdges.add(stage.name, other)
          // 'out' means that the first fulfills a requirement for the second
          outEdges.add(other, stage.name)
        })
      }
    })
    this.inEdges = inEdges
    this.outEdges = outEdges
  }

  /*
    Brings the stages into an topological order using the DFS algo
    as described in https://en.wikipedia.org/wiki/Topological_sorting

    L ← Empty list that will contain the sorted nodes
    while there are unmarked nodes do
        select an unmarked node n
        visit(n)

    function visit(node n)
        if n has a temporary mark then stop (not a DAG)
        if n is not marked (i.e. has not been visited yet) then
            mark n temporarily
            for each node m with an edge from n to m do
                visit(m)
            mark n permanently
            add n to head of L

  */
  _compileStages(stages) {
    var result = []
    var visited = {}
    var visiting = {}
    var inEdges = this.inEdges
    var outEdges = this.outEdges
    // grab all stages that have no dependencies
    var stagesWithoutDeps = []
    forEach(stages, function(stage, name) {
      var deps = inEdges.get(name)
      if (deps.length === 0) {
        stagesWithoutDeps.push(stages[name])
      }
    })
    // and visit them to create the topologically sorted list stored into `result`
    stagesWithoutDeps.forEach(visit)
    this._sortedStages = result
    // if not all stages could be visited, then this is due to a cyclic clique
    // which could not been reached
    if (result.length !== Object.keys(stages).length) {
      throw new Error('Cyclic dependencies found.')
    }
    return

    function visit(stage) {
      if (visiting[stage.name]) {
        throw new Error('Detected cyclic dependency for stage ' + stage.name)
      }
      if (!visited[stage.name]) {
        visiting[stage.name] = true
        var deps = outEdges.get(stage.name) || []
        deps.forEach(function(dep) {
          if (!visited[dep]) visit(stages[dep])
        })
        visited[stage.name] = true
        result.unshift(stage)
      }
    }
  }
}

Flow.Graph = Graph

export default Flow
