set client_min_messages = 'warning';


DROP FUNCTION IF EXISTS "public".save_people(p_json json);
CREATE OR REPLACE FUNCTION "public".save_people(p_json json) RETURNS varchar(128) AS $save_people$
    DECLARE
        v_people_oid                    varchar(128);
        v_total_subledger               int;
        v_sub_ledger_oid                varchar(128);
        v_next_code                     varchar(128);
        v_debit                         json;
        v_credit                        json;
        v_journal_list                  json;
        v_journal_summary               json;
        v_company                       json;
        v_ac_receivable                 varchar(64) := 'ACReceivable';
        v_vendor_credit                 varchar(64) := 'VendorCredit';
        v_ac_payable                    varchar(64) := 'ACPayable';
        v_credit_note                   varchar(64) := 'CreditNote';
        v_adjustment_receivable         varchar(64) := 'AdjustmentReceivable';
        v_adjustment_payable            varchar(64) := 'AdjustmentPayable';
        v_ac_receivable_code            varchar(64) := '0101002';
        v_vendor_credit_code            varchar(64) := '0101004';
        v_ac_payable_code               varchar(64) := '0201004';
        v_credit_note_code              varchar(64) := '0201005';
        v_description                   varchar;
    BEGIN
        select get_company_by_login_id(p_json->>'created_by') into v_company;
        select uuid() INTO v_people_oid;
        select concat('SLGR-', to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')) into v_sub_ledger_oid;

        insert into people (oid, name, mobile_no, email, address, people_type, people_json, payable_balance,
        receivable_balance, 
        image_path, company_oid, created_by, status)
        values (v_people_oid, p_json->>'name',  NULLIF(p_json->>'mobile_no', ''),
            NULLIF(p_json->>'email', ''), NULLIF(p_json->>'address', ''), cast(p_json->>'people_type' as json),
            coalesce(cast(p_json->>'people_json' as json), cast('[]' as json)),
            coalesce((p_json->>'payable_balance')::float, 0),
            coalesce((p_json->>'receivable_balance')::float, 0),
            NULLIF(p_json->>'image_path', ''),
            v_company->>'oid', p_json->>'created_by', p_json->>'status');
        select count(oid)::int INTO v_total_subledger from subledger where company_oid = v_company->>'oid';

        if v_total_subledger = 0 THEN
            SELECT '001' INTO v_next_code;
        else
            select concat(lpad((max(substring(subledger_code, 8)::int4)+1)::varchar(64), 3, '0')) into v_next_code from subledger where company_oid = v_company->>'oid';
        end if;

        insert into subledger (oid, ledger_key, subledger_code, subledger_name, subledger_type, balance_sheet_item, subledger_balance, reference_oid, ledger_oid, company_oid)
        values (concat(v_sub_ledger_oid, '01'), v_ac_receivable, concat(v_ac_receivable_code, v_next_code), p_json->>'name', 'Debit', 'Yes', 0, v_people_oid,
        (select ledger_oid from ledger_setting where company_oid = v_company->>'oid' and ledger_key = v_ac_receivable), v_company->>'oid');

        insert into subledger (oid, ledger_key, subledger_code, subledger_name, subledger_type, balance_sheet_item, subledger_balance, reference_oid, ledger_oid, company_oid)
        values (concat(v_sub_ledger_oid, '02'), v_vendor_credit, concat(v_vendor_credit_code, v_next_code), p_json->>'name', 'Debit', 'Yes', 0, v_people_oid,
        (select ledger_oid from ledger_setting where company_oid = v_company->>'oid' and ledger_key = v_vendor_credit), v_company->>'oid');

        insert into subledger (oid, ledger_key, subledger_code, subledger_name, subledger_type, balance_sheet_item, subledger_balance, reference_oid, ledger_oid, company_oid)
        values (concat(v_sub_ledger_oid, '03'), v_ac_payable, concat(v_ac_payable_code, v_next_code), p_json->>'name', 'Credit', 'Yes', 0, v_people_oid,
        (select ledger_oid from ledger_setting where company_oid = v_company->>'oid' and ledger_key = v_ac_payable), v_company->>'oid');

        insert into subledger (oid, ledger_key, subledger_code, subledger_name, subledger_type, balance_sheet_item, subledger_balance, reference_oid, ledger_oid, company_oid)
        values (concat(v_sub_ledger_oid, '04'), v_credit_note, concat(v_credit_note_code, v_next_code), p_json->>'name', 'Credit', 'Yes', 0, v_people_oid,
        (select ledger_oid from ledger_setting where company_oid = v_company->>'oid' and ledger_key = v_credit_note), v_company->>'oid');

        IF coalesce((p_json->>'receivable_balance')::float, 0) > 0 THEN
            -- Debit
    	    select JSON_BUILD_OBJECT(
        	    'ledger_oid', (select get_ledger_oid(v_company->>'oid', v_ac_receivable)),
        	    'journal_entry_no', 1, 'description', 'Account Receivable Balance', 'debited_amount',
                coalesce((p_json->>'receivable_balance')::float, 0), 'credited_amount', 0,
        	    'subledger_oid', (select get_subledger_oid(v_company->>'oid', v_people_oid, v_ac_receivable))
    	    ) into v_debit;

    	    -- Credit
    	    select JSON_BUILD_OBJECT(
        	    'ledger_oid', (select get_ledger_oid(v_company->>'oid', v_adjustment_receivable)),
        	    'journal_entry_no', 2, 'description', 'Adjustment Receivable Balance', 'debited_amount', 0,
                'credited_amount', coalesce((p_json->>'receivable_balance')::float, 0),
        	    'subledger_oid', null
    	    ) into v_credit;

    	    select json_build_array(v_debit, v_credit) into v_journal_list;

    	    select JSON_BUILD_OBJECT(
                'journal_type', 'Due', 'journal_manner', 'Auto', 'description', 'Account Receivable Balance', 'amount',
                coalesce((p_json->>'receivable_balance')::float, 0), 'reference_no', v_people_oid,
                'company_oid', v_company->>'oid', 'created_by', p_json->>'created_by', 'journal_list', v_journal_list
            ) into v_journal_summary;

           	perform post_journal(v_journal_summary);
        END IF;

        IF coalesce((p_json->>'payable_balance')::float, 0) > 0 THEN
            -- Credit
    	    select JSON_BUILD_OBJECT(
        	    'ledger_oid', (select get_ledger_oid(v_company->>'oid', v_ac_payable)),
        	    'journal_entry_no', 1, 'description', 'Account Payable Balance', 'debited_amount',
                0, 'credited_amount', coalesce((p_json->>'payable_balance')::float, 0),
        	    'subledger_oid', (select get_subledger_oid(v_company->>'oid', v_people_oid, v_ac_payable))
    	    ) into v_debit;

    	    -- Debit
    	    select JSON_BUILD_OBJECT(
        	    'ledger_oid', (select get_ledger_oid(v_company->>'oid', v_adjustment_payable)),
        	    'journal_entry_no', 2, 'description', 'Adjustment Payable Balance',
                'debited_amount', coalesce((p_json->>'payable_balance')::float, 0),
                'credited_amount', 0,
        	    'subledger_oid', null
    	    ) into v_credit;

    	    select json_build_array(v_debit, v_credit) into v_journal_list;

    	    select JSON_BUILD_OBJECT(
                'journal_type', 'Due', 'journal_manner', 'Auto', 'description', 'Account Payable Balance', 'amount',
                coalesce((p_json->>'payable_balance')::float, 0), 'reference_no', v_people_oid,
                'company_oid', v_company->>'oid', 'created_by', p_json->>'created_by', 'journal_list', v_journal_list
            ) into v_journal_summary;

           	perform post_journal(v_journal_summary);
        END IF;
        
        v_description := concat('Add ', p_json->>'name', ' as people');

        insert into activity_log (description, reference_id, reference_name, created_by, company_oid)
		values (v_description, v_people_oid, 'People', v_company->>'login_id', v_company->>'oid');

        return v_people_oid;
    END;
$save_people$ language plpgsql;