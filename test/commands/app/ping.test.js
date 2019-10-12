const {expect, test} = require('@oclif/test')

describe('app:ping', () => {
  test
  .stdout()
  .command(['app:ping'])
  .it('runs hello', ctx => {
    expect(ctx.stdout).to.contain('hello world')
  })

  test
  .stdout()
  .command(['app:ping', '--name', 'jeff'])
  .it('runs hello --name jeff', ctx => {
    expect(ctx.stdout).to.contain('hello jeff')
  })
})
