const {Command, flags} = require('@oclif/command')

class PingCommand extends Command {
  async run() {
    const {flags} = this.parse(PingCommand)
    const axios = require('axios');

    axios.get('https://api.nasa.gov/planetary/apod?api_key=4f6PIpHoVuHaERj5aN423hm0VA9XUiWDz0eafSme')
      .then(response => {
        console.log(response.data.url);
        console.log(response.data.explanation);
      })
      .catch(error => {
        console.log(error);
      });

  }
}

PingCommand.description = `Describe the command here
...
Extra documentation goes here
`

PingCommand.flags = {
  name: flags.string({char: 'n', description: 'name to print'}),
}

module.exports = PingCommand
