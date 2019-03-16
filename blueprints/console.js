'use strict'

Blueprint = {
  name: 'Console',

  in: function(data) {
    console.log('Console:', data)
    this.out(data)
  },
}
