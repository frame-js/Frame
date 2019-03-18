'use strict'

Blueprint = {
  name: 'Console',

  in: function(data, props) {
    console.log('Console:', data, ':', props)
    this.out(data)
  },
}
