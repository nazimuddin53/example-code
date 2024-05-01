"use strict"

const _ = require("underscore")
const Joi = require("@hapi/joi")
const Dao = require("../../../util/dao")
const log = require("../../../util/log")
const { TABLE, ROLE, API } = require("../../../util/constant")

const payload_scheme = Joi.object({
	from_date: Joi.string().trim().length(10).allow(null, '').optional(),
	to_date: Joi.string().trim().length(10).allow(null, '').optional(),
	offset: Joi.number().optional().allow(null, 0),
	limit: Joi.number().optional().allow(null, 0),
	search_text: Joi.string().optional().allow(null, ""),
	people_oid: Joi.string().optional().allow(null, ""),
	amount_type: Joi.string().trim().optional().allow(null, '').valid('Paid', 'Due'),
	status: Joi.array().items(Joi.string().trim().optional().allow(null, '').valid('Draft', 'Submitted', 'Rejected', 'Approved')).optional(),
	type: Joi.string().trim().valid("Service", "Product", "Ticket").allow(null, '').optional(),

})

const route_controller = {
	method: "POST",
	path: API.CONTEXT + API.BILL_GET_LIST_PATH,
	options: {
		auth: {
			mode: "required",
			strategy: "jwt",
		},
		description: "get bill list",
		plugins: { hapiAuthorization: false },
		validate: {
			payload: payload_scheme,
			options: {
				allowUnknown: false,
			},
			failAction: async (request, h, err) => {
				return h
					.response({ code: 301, status: false, message: err?.message })
					.takeover()
			},
		},
	},
	handler: async (request, h) => {
		log.debug(`Request received - ${JSON.stringify(request.payload)}`)
		const response = await handle_request(request)
		log.debug(`Response sent - ${JSON.stringify(response)}`)
		return h.response(response)
	},
}

const handle_request = async (request) => {
	let count = await get_count(request)
	let data = await get_data(request)
	if (count == 0) {
		log.warn(`[${request.auth.credentials.company_oid}/${request.auth.credentials.login_id}] - no bill list found`)
		return { status: false, code: 201, message: `No data found` }
	}
	log.info(`[${request.auth.credentials.company_oid}/${request.auth.credentials.login_id}] - ${count} bill list found`)
	return { status: true, code: 200, message: `Successfully get bill list`, total: count, data: data, }
}

const get_count = async (request) => {
	let count = 0
	let index = 1
	let param = []
	let query = `select count(*)::int4 as total
		from ${TABLE.BILL_INFORMATION} ex 
		left join ${TABLE.PEOPLE} p on p.oid = ex.people_oid
		where 1=1 and ex.company_oid = $${index++}`

	param.push(request.auth.credentials.company_oid)

	if (request.payload.status && request.payload.status.length > 0) {
		let status = request.payload.status.map((x) => `'${x}'`).join(", ")
		query += ` and ex.status in (${status})`
	}
	if (request.payload.type && request.payload.type.length > 0) {
		let type = request.payload.type
		query += ` and ex.type = $${index++}`
		param.push(type)
	}

	if (request.payload.amount_type && request.payload.amount_type.length > 0) {
		if (request.payload.amount_type == 'Due') {
			query += ` and ex.due_amount > 0`
		} else {
			query += ` and ex.bill_amount = ex.paid_amount`
		}
	}

	if (request.payload.people_oid && request.payload.people_oid.length > 0) {
		query += ` and ex.people_oid = $${index++}`
		param.push(request.payload.people_oid)
	}

	if (request.payload.search_text && request.payload.search_text.length > 0) {
		query += ` and (lower(ex.bill_no) ilike $${index}
				or lower(p.name) ilike $${index++})`
		param.push(`%${request.payload.search_text}%`)
	}

	if (request.payload.from_date) {
		query += ` and ex.bill_date >= $${index++}`
		param.push(`${request.payload.from_date}`)
	}

	if (request.payload.to_date) {
		query += ` and ex.bill_date <= $${index++}`
		param.push(`${request.payload.to_date}`)
	}

	if (request.auth.credentials.role == ROLE.MAKER) {
		query += ` and ex.created_by = $${index++}`
		param.push(request.auth.credentials.login_id)
	}

	if (request.auth.credentials.role == ROLE.APPROVER) {
		query += ` and (
			(ex.approved_by is null or ex.approved_by = $${index++})
			and
			(ex.rejected_by is null or ex.rejected_by = $${index++})
		)`
		param.push(request.auth.credentials.login_id)
		param.push(request.auth.credentials.login_id)
	}

	if (request.auth.credentials.role == ROLE.ADMIN) {
		query += ` and (
			ex.created_by = $${index++}
			or (ex.created_by != $${index++} and ex.status != $${index++})
		)`
		param.push(request.auth.credentials.login_id)
		param.push(request.auth.credentials.login_id)
		param.push('Draft')
	}

	let sql = {
		text: query,
		values: param,
	}
	try {
		let data_set = await Dao.get_data(request.pg, sql)
		count = data_set[0]["total"]
	} catch (e) {
		log.error(
			`An exception occurred while getting bill list count : ${e?.message}`
		)
	}
	return count
}

const get_data = async (request) => {
	let data = []
	let index = 1
	let param = []
	let query = `select ex.oid, ex.type, ex.bill_no, ex.description, to_char(ex.bill_date, 'DD Mon, YYYY') as "bill_date", ex.image_path,
  		ex.bill_amount::float8, ex.status, ex.people_oid, ex.created_by, ex.company_oid,
		ex.paid_amount::float8, ex.due_amount::float8, 
		p.name as supplier_name 
      	from ${TABLE.BILL_INFORMATION} ex
		left join ${TABLE.PEOPLE} p on p.oid = ex.people_oid
		where 1=1 and ex.company_oid = $${index++}`
	param.push(request.auth.credentials.company_oid)

	if (request.payload.status && request.payload.status.length > 0) {
		let status = request.payload.status.map((x) => `'${x}'`).join(", ")
		query += ` and ex.status in (${status})`
	}
	if (request.payload.type && request.payload.type.length > 0) {
		query += ` and ex.type = $${index++}`
		param.push(request.payload.type)
	}

	if (request.payload.amount_type && request.payload.amount_type.length > 0) {
		if (request.payload.amount_type == 'Due') {
			query += ` and ex.due_amount > 0`
		} else {
			query += ` and ex.bill_amount = ex.paid_amount`
		}
	}

	if (request.payload.people_oid && request.payload.people_oid.length > 0) {
		
		query += ` and ex.people_oid = $${index++}`
		param.push(request.payload.people_oid)

	}

	if (request.payload.search_text && request.payload.search_text.length > 0) {
		query += ` and (lower(ex.bill_no) ilike $${index}
				or lower(p.name) ilike $${index++})`
		param.push(`%${request.payload.search_text}%`)
	}

	if (request.payload.from_date) {
		query += ` and ex.bill_date >= $${index++}`
		param.push(`${request.payload.from_date}`)
	}

	if (request.payload.to_date) {
		query += ` and ex.bill_date <= $${index++}`
		param.push(`${request.payload.to_date}`)
	}

	if (request.auth.credentials.role == ROLE.MAKER) {
		query += ` and ex.created_by = $${index++}`
		param.push(request.auth.credentials.login_id)
	}

	if (request.auth.credentials.role == ROLE.APPROVER) {
		query += ` and ex.status != $${index++} and (
			(ex.approved_by is null or ex.approved_by = $${index++})
			and
			(ex.rejected_by is null or ex.rejected_by = $${index++})
		)`
		param.push('Draft')
		param.push(request.auth.credentials.login_id)
		param.push(request.auth.credentials.login_id)
	}

	if (request.auth.credentials.role == ROLE.ADMIN) {
		query += ` and (
			ex.created_by = $${index++}
			or (ex.created_by != $${index++} and ex.status != $${index++})
		)`
		param.push(request.auth.credentials.login_id)
		param.push(request.auth.credentials.login_id)
		param.push('Draft')
	}

	query += ` order by ex.bill_date desc, ex.created_on desc`

	if (request.payload.limit) {
		query += ` limit $${index++} offset $${index++}`
		param.push(request.payload.limit)
		param.push(request.payload.offset)
	}

	let sql = {
		text: query,
		values: param,
	}
	try {
		data = await Dao.get_data(request.pg, sql)
	} catch (e) {
		log.error(`An exception occurred while getting bill list : ${e?.message}`)
	}
	return data
}

module.exports = route_controller
