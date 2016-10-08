import { module, spy } from 'substance-test'
import forEach from 'lodash/forEach'
import Flow from '../../util/Flow'

const test = module('util/Flow')

test("Compiling a flow without dependencies", function(t) {
  var flow = new Flow([{ name: 'a' }, { name: 'b'}])
  // Note: sorting as there is no guaranteed order
  t.deepEqual(flow.getStageNames().sort(), ['a', 'b'], 'There should be two stages.')
  t.end()
})

test("Compiling a flow with 2 dependent stages", function(t) {
  var flow = new Flow([{ name: 'a' }, { name: 'b', requires: ['a'] }])
  // Note: sorting as there is no guaranteed order
  var stages = flow.getStageNames()
  t.deepEqual(stages, ['a', 'b'], 'The stages should be in correct order.')
  t.end()
})

test("Compiling a diamond (all permutations)", function(t) {
  var stages = {
    a: { name: 'a' },
    b: { name: 'b', requires: ['a'] },
    c: { name: 'c', requires: ['a'] },
    d: { name: 'd', requires: ['c', 'b'] },
  }
  function testPermutation(perm) {
    var s = perm.map(function(name) {
      return stages[name]
    })
    var flow = new Flow(s)
    var names = flow.getStageNames()
    var P = _positions(names)
    t.ok(P['a'] < P['b'] && P['a'] < P['c'] && P['d'] > P['b'] && P['d'] > P['c'],
      "Permutation " + perm + " should be compiled correctly")
  }
  testPermutation(['a', 'b', 'c', 'd'])
  testPermutation(['a', 'b', 'd', 'c'])
  testPermutation(['a', 'c', 'b', 'd'])
  testPermutation(['a', 'c', 'd', 'b'])
  testPermutation(['a', 'd', 'b', 'c'])
  testPermutation(['a', 'd', 'c', 'b'])
  testPermutation(['b', 'a', 'c', 'd'])
  testPermutation(['b', 'a', 'd', 'c'])
  testPermutation(['b', 'c', 'a', 'd'])
  testPermutation(['b', 'c', 'd', 'a'])
  testPermutation(['b', 'd', 'a', 'c'])
  testPermutation(['b', 'd', 'c', 'a'])
  testPermutation(['c', 'b', 'a', 'd'])
  testPermutation(['c', 'b', 'd', 'a'])
  testPermutation(['c', 'a', 'b', 'd'])
  testPermutation(['c', 'a', 'd', 'b'])
  testPermutation(['c', 'd', 'b', 'a'])
  testPermutation(['c', 'd', 'a', 'b'])
  testPermutation(['d', 'b', 'c', 'a'])
  testPermutation(['d', 'b', 'a', 'c'])
  testPermutation(['d', 'c', 'b', 'a'])
  testPermutation(['d', 'c', 'a', 'b'])
  testPermutation(['d', 'a', 'b', 'c'])
  testPermutation(['d', 'a', 'c', 'b'])
  t.end()
})

test("Compiling a flow with cyclic dependencies stages", function(t) {
  t.throws(function() {
    new Flow([
      {name: 'a', requires: ['b']},
      {name: 'b', requires: ['a']}
    ])
  }, "Cyclic clique should be detected.")
  t.throws(function() {
    new Flow([
      {name: 'a'},
      {name: 'b', requires: ['d', 'a']},
      {name: 'c', requires: ['b']},
      {name: 'd', requires: ['c']}
    ])
  }, "Cyclic dependency should be detected.")
  t.end()
})

test("Trigger listeners in a flow", function(t) {
  var flow = new Flow([
    {name: 'a'},
    {name: 'b', requires: ['a']}
  ])
  var on_a = spy(function() {})
  var before_b = spy(function() {
    flow.setState('b', { bla: 'blupp' })
  })
  var on_b = spy(function() {})

  flow.on('a', on_a)
  flow.before('b', before_b)
  flow.on('b', on_b)

  flow.setState('a', {foo: 'bar'})
  t.equal(on_a.callCount, 1, "Listener for 'a' should have been called")
  t.deepEqual(on_a.args[0], {foo: 'bar'}, ".. receiving a's state")
  t.equal(before_b.callCount, 1, "Listener for 'before:b' should have been called")
  t.equal(on_b.callCount, 1, "Listener for 'b' should have been called")
  t.deepEqual(on_b.args[0], {bla: 'blupp'}, ".. receiving b's state")

  t.end()
})

var _fixture = function() {
  var stages = [
    {name: 'a'},
    {name: 'b', requires: ['a']},
    {name: 'c'},
    {name: 'd', requires: ['b', 'c']}
  ]
  var flow = new Flow(stages)
  var listeners = {}
  stages.forEach(function(stage) {
    var l = spy(function() {})
    flow.on(stage.name, l)
    listeners[stage.name] = l
  })
  return {
    flow: flow,
    listeners: listeners,
    stages: stages
  }
}

var _checkListeners = function(t, expected, l, name) {
  if (expected[name]) {
    t.equal(l.callCount, 1, "Listener '"+name+"' should have been called once.")
  } else {
    t.equal(l.callCount, 0, "Listener '"+name+"' should not have been called.")
  }
}

test("Trigger only necessary listeners (I)", function(t) {
  var fixture = _fixture()
  var expected = { a: 1, b: 1, c: 0, d: 1}
  // all should be triggered if state 'a' has changed
  fixture.flow.setState('a', {foo: 'bar'})
  forEach(fixture.listeners, _checkListeners.bind(null, t, expected))
  t.end()
})

test("Trigger only necessary listeners (II)", function(t) {
  var fixture = _fixture()
  var expected = { a: 0, b: 1, c: 0, d: 1}
  // all should be triggered if state 'a' has changed
  fixture.flow.setState('b', {foo: 'bar'})
  forEach(fixture.listeners, _checkListeners.bind(null, t, expected))
  t.end()
})

test("Trigger only necessary listeners (III)", function(t) {
  var fixture = _fixture()
  var expected = { a: 0, b: 0, c: 1, d: 1}
  // all should be triggered if state 'a' has changed
  fixture.flow.setState('c', {foo: 'bar'})
  forEach(fixture.listeners, _checkListeners.bind(null, t, expected))
  t.end()
})


function _positions(vals) {
  var P = {}
  forEach(vals, function(val, pos) {
    P[val] = pos
  })
  return P
}
