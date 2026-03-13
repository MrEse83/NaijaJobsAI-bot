
const https = require('https')

const data = JSON.stringify({

  email: 'test@test.com',

  amount: 300000,

  metadata: {

    custom_fields: [

      {

        display_name: 'Telegram ID',

        variable_name: 'telegram_id',

        value: '1114056335'

      }

    ]

  }

})

const options = {

  hostname: 'api.paystack.co',

  path: '/transaction/initialize',

  method: 'POST',

  headers: {

    'Authorization': 'Bearer sk_test_3848fb2b3bc4d634247a6415d45a63d911c71a11',

    'Content-Type': 'application/json',

    'Content-Length': data.length

  }

}

const req = https.request(options, (res) => {

  let body = ''

  res.on('data', (chunk) => body += chunk)

  res.on('end', () => {

    const result = JSON.parse(body)

    console.log('Payment URL:', result.data?.authorization_url)

  })

})

req.write(data)

req.end()

